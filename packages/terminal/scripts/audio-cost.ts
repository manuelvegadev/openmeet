/**
 * Where the CPU of an audio-only call actually goes.
 *
 * Every phase runs the same 10 ms frame cadence the engine runs and measures process CPU
 * across all threads. A unidirectional loopback connection costs one Opus encode plus one
 * decode, which is exactly what one peer in the mesh costs us: we encode for them, we
 * decode what they send.
 *
 *   pnpm exec tsx scripts/audio-cost.ts [seconds-per-phase]
 */
import wrtc from '@roamhq/wrtc';
import { InputConditioner } from '../src/lib/audio/channels.js';
import { CHANNELS, FRAME_SAMPLES, FRAME_SIZE, SAMPLE_RATE } from '../src/lib/audio/constants.js';
import { FrameMixer, PeerPlayoutBuffer } from '../src/lib/audio/mixer.js';
import { CaptureProcessorChain } from '../src/lib/audio/processors.js';
import { ToneGenerator } from '../src/lib/audio/tone.js';
import { boostOpusQuality, capOutgoingAudioBitrate, preferAudioRed } from '../src/lib/sdp.js';
import { createAudioSource } from '../src/lib/webrtc.js';

const { RTCPeerConnection } = wrtc as any;
const { RTCAudioSink } = (wrtc as any).nonstandard;

const SECONDS = Number(process.argv[2]) || 12;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Shape = 'app' | 'lean' | 'default';

/** The app's own SDP surgery, or a lean mono/32k/DTX variant, or libwebrtc untouched. */
function shapeLocal(sdp: string, shape: Shape): string {
  if (shape === 'default') return sdp;
  if (shape === 'app') return preferAudioRed(boostOpusQuality(sdp, 128));
  return sdp.replace(
    /^(a=fmtp:(\d+) [^\r\n]*minptime[^\r\n]*)$/m,
    (line) => `${line};stereo=0;sprop-stereo=0;maxaveragebitrate=32000;usedtx=1`,
  );
}
function shapeRemote(sdp: string, shape: Shape): string {
  if (shape === 'app') return capOutgoingAudioBitrate(sdp, 128);
  if (shape === 'lean') return capOutgoingAudioBitrate(sdp, 32);
  return sdp;
}

/** One peer: our track out, their audio back into a sink. */
async function connect(track: any | null, shape: Shape, onRemote: ((s: Int16Array, n: number) => void) | null) {
  const a = new RTCPeerConnection({ iceServers: [] });
  const b = new RTCPeerConnection({ iceServers: [] });
  a.onicecandidate = (e: any) => e.candidate && b.addIceCandidate(e.candidate);
  b.onicecandidate = (e: any) => e.candidate && a.addIceCandidate(e.candidate);

  const got = new Promise<any>((resolve) => {
    b.ontrack = (e: any) => resolve(e.track);
  });
  if (track) a.addTrack(track);
  else a.addTransceiver('audio', { direction: 'recvonly' });

  const offer = await a.createOffer();
  offer.sdp = shapeLocal(offer.sdp, shape);
  await a.setLocalDescription(offer);
  await b.setRemoteDescription({ type: 'offer', sdp: shapeRemote(offer.sdp, shape) });
  const answer = await b.createAnswer();
  answer.sdp = shapeLocal(answer.sdp, shape);
  await b.setLocalDescription(answer);
  await a.setRemoteDescription({ type: 'answer', sdp: shapeRemote(answer.sdp, shape) });

  const remoteTrack = track ? await got : null;
  await new Promise<void>((resolve) => {
    if (a.connectionState === 'connected') return resolve();
    a.onconnectionstatechange = () => a.connectionState === 'connected' && resolve();
  });
  let sink: any = null;
  if (remoteTrack && onRemote) {
    sink = new RTCAudioSink(remoteTrack);
    sink.ondata = (d: any) => onRemote(d.samples, d.numberOfFrames);
  }
  return { a, b, sink };
}

async function main() {
  console.log(`platform ${process.platform}/${process.arch}, node ${process.versions.node}, ${SECONDS}s per phase\n`);

  const conditioner = new InputConditioner('auto', 0);
  const processors = new CaptureProcessorChain();
  const mixer = new FrameMixer();
  const tone = new ToneGenerator({ hz: 440, seconds: 1e9, gain: 0.2 });
  const captureFrame = new Int16Array(FRAME_SAMPLES);
  const mixOut = new Int16Array(FRAME_SAMPLES);
  const buffers: { buffer: PeerPlayoutBuffer; volume: number }[] = [];

  let source: any = null;
  let timer: NodeJS.Timeout | null = null;
  const tick = () => {
    tone.fill(captureFrame);
    conditioner.process(captureFrame);
    const outgoing = processors.process(captureFrame);
    if (source) {
      // As AudioManager does: WebRTC gets a frame it owns.
      const owned = new Int16Array(FRAME_SAMPLES);
      owned.set(outgoing);
      source.onData({
        samples: owned,
        sampleRate: SAMPLE_RATE,
        bitsPerSample: 16,
        channelCount: CHANNELS,
        numberOfFrames: FRAME_SIZE,
      });
    }
    mixer.mix(mixOut, buffers);
  };

  const results: { name: string; cpu: number; rss: number }[] = [];
  async function phase(name: string) {
    await sleep(1500); // settle
    const cpu0 = process.cpuUsage();
    const t0 = performance.now();
    await sleep(SECONDS * 1000);
    const cpu = process.cpuUsage(cpu0);
    const elapsed = performance.now() - t0;
    const pct = ((cpu.user + cpu.system) / 1000 / elapsed) * 100;
    results.push({ name, cpu: pct, rss: process.memoryUsage().rss / 1e6 });
    console.log(`  ${name.padEnd(34)} ${pct.toFixed(1).padStart(6)}% cpu`);
  }

  timer = setInterval(tick, 10);
  await phase('1. frame pipeline only (no wrtc)');

  const made = createAudioSource();
  source = made.source;
  await phase('2. + RTCAudioSource.onData, no peers');

  const peers: any[] = [];
  async function addPeer(shape: Shape, opts: { track?: boolean; sink?: boolean } = {}) {
    const wantTrack = opts.track !== false;
    const wantSink = opts.sink !== false;
    const buf = new PeerPlayoutBuffer();
    if (wantSink) buffers.push({ buffer: buf, volume: 1 });
    peers.push(await connect(wantTrack ? made.track : null, shape, wantSink ? (s, n) => buf.push(s, n) : null));
  }
  async function dropPeers() {
    for (const p of peers) {
      p.sink?.stop?.();
      p.a.close();
      p.b.close();
    }
    peers.length = 0;
    buffers.length = 0;
  }

  await addPeer('app', { track: false, sink: false });
  await phase('2b. + 1 connected PC, no media at all');
  await dropPeers();

  await addPeer('app', { sink: false });
  await phase('2c. + 1 PC, we send only (no decode)');
  await dropPeers();

  await addPeer('app');
  await phase('3. + 1 peer, app SDP (stereo 128k+RED)');
  await addPeer('app');
  await addPeer('app');
  await phase('4. + 3 peers, app SDP (4-person room)');
  await dropPeers();

  await addPeer('lean');
  await phase('5. 1 peer, mono 32k + DTX');
  await addPeer('lean');
  await addPeer('lean');
  await phase('6. 3 peers, mono 32k + DTX');
  await dropPeers();

  await addPeer('default');
  await phase('7. 1 peer, libwebrtc defaults');
  await dropPeers();

  source = null;
  await phase('8. frame pipeline only again (control)');

  if (timer) clearInterval(timer);
  console.log(`\n${'─'.repeat(60)}`);
  for (const r of results)
    console.log(`${r.name.padEnd(40)} ${r.cpu.toFixed(1).padStart(6)}%  rss ${r.rss.toFixed(0)}MB`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
