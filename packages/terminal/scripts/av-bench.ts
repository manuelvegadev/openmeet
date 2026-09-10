/**
 * A/V pipeline benchmark — what the video paths cost the engine's event loop.
 *
 * The 10 ms audio cadence shares that loop, so every millisecond video spends there is a
 * millisecond audio can be late. This drives the real `VideoManager` on both sides of a
 * loopback PeerConnection (real ffmpeg capture, real VP8 encode/decode, real ffplay) while
 * a real audio frame pipeline runs at 10 ms, and reports how late that cadence ran.
 *
 * Phases: `idle` (audio only) → `send` (+ capture and encode) → `send+recv` (+ decode,
 * rescale and display). Receive cost is the difference between the last two.
 *
 *   pnpm exec tsx scripts/av-bench.ts [seconds-per-phase] [screen-index]
 *
 * `OPENMEET_BENCH_NOISE=1` puts RNNoise in the capture chain, as the app does when noise
 * suppression is on, so its cost shows up in the same audio-gap numbers.
 *
 * Windows note: screen capture needs the interactive desktop, so run it from the console
 * session (a desktop shortcut or `schtasks /it`), never over SSH.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import wrtc from '@roamhq/wrtc';
import { InputConditioner } from '../src/lib/audio/channels.js';
import { CHANNELS, FRAME_SAMPLES, FRAME_SIZE, SAMPLE_RATE } from '../src/lib/audio/constants.js';
import { FrameMixer, PeerPlayoutBuffer } from '../src/lib/audio/mixer.js';
import { createNoiseSuppressor } from '../src/lib/audio/noise-suppression.js';
import { CaptureProcessorChain } from '../src/lib/audio/processors.js';
import { ToneGenerator } from '../src/lib/audio/tone.js';
import { listScreenDevices } from '../src/lib/devices.js';
import { percentiles } from '../src/lib/diagnostics.js';
import { createVideoSource, VideoManager } from '../src/lib/video.js';
import { createAudioSource } from '../src/lib/webrtc.js';

const { RTCPeerConnection } = wrtc as any;
const { RTCAudioSink } = (wrtc as any).nonstandard;

const SECONDS = Number(process.argv[2]) || 10;
const SCREEN_INDEX = Number(process.argv[3]) || 0;
const AUDIO_PERIOD_MS = 10;
/** Matches the engine's "Audio clock" metric: a gap this large is an audible glitch. */
const GAP_THRESHOLD_MS = 30;

// ─── metrics ──────────────────────────────────────────────────────────────────

class Samples {
  private values: number[] = [];
  add(v: number): void {
    this.values.push(v);
  }
  over(threshold: number): number {
    return this.values.filter((v) => v > threshold).length;
  }
  stats(): { p50: number; p99: number; max: number } {
    return percentiles(this.values);
  }
}

interface PhaseResult {
  name: string;
  audioGap: { p50: number; p99: number; max: number };
  audioGlitches: number;
  recvHandler: { p50: number; p99: number; max: number };
  loop: { p50: number; p99: number; max: number };
  cpuPercent: number;
  framesCaptured: number;
  framesDisplayed: number;
}

// ─── the real audio pipeline, at 10 ms ────────────────────────────────────────

/**
 * Capture conditioning → WebRTC, and one remote peer's decoded audio → mixer, exactly as
 * `AudioManager` does it, driven by a timer instead of the sound card. Records how late
 * each tick ran: that lateness is what the sound card would have turned into a dropout.
 */
class AudioCadence {
  private readonly conditioner = new InputConditioner('auto', 0);
  private readonly processors = new CaptureProcessorChain();
  private readonly mixer = new FrameMixer();
  private readonly captureFrame = new Int16Array(FRAME_SAMPLES);
  private readonly outgoing = new Int16Array(FRAME_SAMPLES);
  private readonly mixOut = new Int16Array(FRAME_SAMPLES);
  private readonly playout = new PeerPlayoutBuffer();
  private readonly sources = [{ buffer: this.playout, volume: 1 }];
  private timer: NodeJS.Timeout | null = null;
  private last = 0;
  /** Gap between consecutive frames — the same thing the engine logs as "Audio clock". */
  gaps = new Samples();

  /** A real 440 Hz tone, so the conditioner's auto detection and RNNoise see actual signal. */
  private readonly tone = new ToneGenerator({ hz: 440, seconds: 1e9, gain: 0.2 });

  constructor(private readonly audioSource: any) {
    if (process.env.OPENMEET_BENCH_NOISE === '1') {
      const suppressor = createNoiseSuppressor();
      if (suppressor) this.processors.add(suppressor);
      else console.error('noise suppression requested but unavailable');
    }
  }

  /** A remote peer's decoded frames land here, as `AudioManager` routes RTCAudioSink output. */
  pushRemote(samples: Int16Array, frames: number): void {
    this.playout.push(samples, frames);
  }

  start(): void {
    this.last = performance.now();
    this.timer = setInterval(() => this.tick(), AUDIO_PERIOD_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  resetMetrics(): void {
    this.gaps = new Samples();
    this.last = performance.now();
  }

  private tick(): void {
    const now = performance.now();
    this.gaps.add(now - this.last);
    this.last = now;

    this.tone.fill(this.captureFrame);
    this.conditioner.process(this.captureFrame);
    const outgoing = this.processors.process(this.captureFrame);
    // AudioManager hands WebRTC a frame it owns; copying here keeps the same cost in view.
    this.outgoing.set(outgoing);
    this.audioSource.onData({
      samples: this.outgoing,
      sampleRate: SAMPLE_RATE,
      bitsPerSample: 16,
      channelCount: CHANNELS,
      numberOfFrames: FRAME_SIZE,
    });
    this.mixer.mix(this.mixOut, this.sources);
  }
}

// ─── loopback ─────────────────────────────────────────────────────────────────

async function connectLoopback(tracks: any[]): Promise<{ remote: Map<string, any> }> {
  const a = new RTCPeerConnection({ iceServers: [] });
  const b = new RTCPeerConnection({ iceServers: [] });
  a.onicecandidate = (e: any) => e.candidate && b.addIceCandidate(e.candidate);
  b.onicecandidate = (e: any) => e.candidate && a.addIceCandidate(e.candidate);

  const remote = new Map<string, any>();
  const gotAll = new Promise<void>((resolve) => {
    b.ontrack = (e: any) => {
      remote.set(e.track.kind, e.track);
      if (remote.size === tracks.length) resolve();
    };
  });

  for (const t of tracks) a.addTrack(t);
  await a.setLocalDescription(await a.createOffer());
  await b.setRemoteDescription(a.localDescription);
  await b.setLocalDescription(await b.createAnswer());
  await a.setRemoteDescription(b.localDescription);

  await gotAll;
  await new Promise<void>((resolve) => {
    if (a.connectionState === 'connected') return resolve();
    a.onconnectionstatechange = () => a.connectionState === 'connected' && resolve();
  });
  return { remote };
}

// ─── driver ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const screens = listScreenDevices();
  if (screens.length === 0) {
    console.error('No screens found. On Windows run this from the console session, not over SSH.');
    process.exit(1);
  }
  const screen = screens[Math.min(SCREEN_INDEX, screens.length - 1)];

  console.log(`platform     ${process.platform} ${process.arch}, node ${process.versions.node}`);
  console.log(`screen       ${screen.name}${screen.width ? ` (${screen.width}x${screen.height})` : ''}`);
  console.log(`noise        ${process.env.OPENMEET_BENCH_NOISE === '1' ? 'RNNoise on' : 'off'}`);
  console.log(`phases       ${SECONDS}s each\n`);

  const { source: audioSource, track: audioTrack } = createAudioSource();
  const { source: videoSource, track: videoTrack } = createVideoSource();
  const { remote } = await connectLoopback([audioTrack, videoTrack]);

  const cadence = new AudioCadence(audioSource);
  const audioSink = new RTCAudioSink(remote.get('audio'));
  audioSink.ondata = (d: any) => cadence.pushRemote(d.samples, d.numberOfFrames);
  cadence.start();

  const sendManager = new VideoManager();
  const recvManager = new VideoManager();
  let framesCaptured = 0;
  let framesDisplayed = 0;
  let recvHandlerMs = new Samples();

  // Count what actually reaches the encoder. `onFrame` is a read-only native method, so
  // the manager gets a proxy rather than a patched source.
  const countingSource = new Proxy(videoSource, {
    get(target: any, prop: string | symbol) {
      if (prop === 'onFrame') {
        return (frame: any) => {
          framesCaptured++;
          target.onFrame(frame);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  const loop = monitorEventLoopDelay({ resolution: 5 });
  loop.enable();
  const results: PhaseResult[] = [];

  async function phase(name: string): Promise<void> {
    cadence.resetMetrics();
    loop.reset();
    const cpu0 = process.cpuUsage();
    const t0 = performance.now();
    const captured0 = framesCaptured;
    const displayed0 = framesDisplayed;
    recvHandlerMs = new Samples();

    await sleep(SECONDS * 1000);

    const elapsed = (performance.now() - t0) / 1000;
    const cpu = process.cpuUsage(cpu0);
    const ms = (n: number) => n / 1e6;
    results.push({
      name,
      audioGap: cadence.gaps.stats(),
      audioGlitches: cadence.gaps.over(GAP_THRESHOLD_MS),
      recvHandler: recvHandlerMs.stats(),
      loop: { p50: ms(loop.percentile(50)), p99: ms(loop.percentile(99)), max: ms(loop.max) },
      cpuPercent: ((cpu.user + cpu.system) / 1000 / (elapsed * 1000)) * 100,
      framesCaptured: framesCaptured - captured0,
      framesDisplayed: framesDisplayed - displayed0,
    });
    console.log(`  ${name} done`);
  }

  console.log('running phases...');
  await phase('idle');

  sendManager.startScreenCapture(countingSource, screen);
  await sleep(2000); // let ffmpeg reach steady state before measuring
  await phase('send');

  recvManager.addRemotePeer('bench', remote.get('video'), 'screen', 'bench');
  // Time the real receive handler (rescale + letterbox + overlay + write to ffplay).
  const peer = [...(recvManager as any).peers.values()][0];
  if (peer?.sink) {
    const inner = peer.sink.onframe;
    peer.sink.onframe = (e: any) => {
      const t = performance.now();
      inner?.(e);
      recvHandlerMs.add(performance.now() - t);
      framesDisplayed++;
    };
  } else {
    console.error('receive path not wired — sink missing');
  }
  await sleep(2000);
  await phase('send+recv');

  cadence.stop();
  audioSink.stop?.();
  sendManager.shutdown();
  recvManager.shutdown();
  report(results, screen.name);
  process.exit(0);
}

function report(results: PhaseResult[], screenName: string): void {
  const f = (n: number, w = 6) => n.toFixed(1).padStart(w);
  console.log(`\n${'─'.repeat(78)}`);
  console.log(`RESULTS  ${new Date().toISOString()}  ${process.platform}/${process.arch}  ${screenName}`);
  console.log('─'.repeat(78));
  console.log('phase        audio frame gap (ms)    loop delay (ms)      recv handler   node    frames');
  console.log('             p50    p99    max      p50    p99    max     p50    max      CPU    cap/disp  glitch');
  for (const r of results) {
    console.log(
      `${r.name.padEnd(12)}${f(r.audioGap.p50, 5)} ${f(r.audioGap.p99, 6)} ${f(r.audioGap.max, 6)}  ` +
        `${f(r.loop.p50, 7)} ${f(r.loop.p99, 6)} ${f(r.loop.max, 6)}  ` +
        `${f(r.recvHandler.p50, 6)} ${f(r.recvHandler.max, 6)}  ` +
        `${f(r.cpuPercent, 7)}%  ${String(r.framesCaptured).padStart(4)}/${String(r.framesDisplayed).padStart(4)}  ` +
        `${String(r.audioGlitches).padStart(6)}`,
    );
  }
  console.log('─'.repeat(78));
  console.log(`audio frame gap: 10ms is perfect. glitch = a gap over ${GAP_THRESHOLD_MS}ms, i.e. dropped audio.`);
  console.log('recv handler: time inside the frame callback — rescale, letterbox, overlay, write to ffplay.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
