/**
 * The app's own screen-share flow, in one process, no devices:
 * pnpm --filter openmeet-terminal exec tsx scripts/share-probe.ts
 *
 * Two real PeerConnectionManagers wired back to back. "mid-call" (the case that failed on
 * Windows, gotcha 33): A is the offerer with no webcam track, connects, then shares. "at join"
 * (the case that worked): B shares first, then A connects as offerer and B answers with the
 * track present. Both must encode, and the sharer's send budget must reach the log.
 */
import { createVideoSource } from '../src/lib/video.js';
import { createAudioSource, PeerConnectionManager } from '../src/lib/webrtc.js';
import { check, finish, sleep } from './harness.js';

const budgets: string[] = [];

function pair() {
  const managers: Record<string, PeerConnectionManager> = {};
  const make = (id: string, other: string, screenTrack?: any) =>
    new PeerConnectionManager({
      myId: id,
      audioTrack: createAudioSource().track,
      screenTrack,
      sendSignal: (msg: any) => {
        const to = managers[other];
        if (msg.type === 'offer') void to.handleOffer(id, msg.sdp);
        else if (msg.type === 'answer') void to.handleAnswer(id, msg.sdp);
        else if (msg.type === 'ice-candidate') void to.handleIceCandidate(id, msg.candidate);
      },
      onRemoteAudioTrack: () => {},
      onRemoteVideoTrack: (_p, _t, type) => console.log(`  ${other} got ${type} track from ${id}`),
      onPeerDisconnected: () => {},
      onDebug: (m) => {
        if (/encodings|refused|failed|send budget/.test(m)) console.log(`  [${id}] ${m}`);
        if (/send budget/.test(m)) budgets.push(m);
      },
    });
  return { managers, make };
}

async function encodedFrames(pm: PeerConnectionManager, peer: string): Promise<number> {
  for (const s of (await pm.getConnection(peer).getStats()).values()) {
    if (s.type === 'outbound-rtp' && s.kind === 'video' && String(s.mid) === '2') return s.framesEncoded ?? 0;
  }
  return 0;
}

/** A 1080p screencast source fed a changing flat frame at 30 fps. */
function screenSource() {
  const { source, track } = createVideoSource({ isScreencast: true });
  const data = new Uint8ClampedArray(1920 * 1080 * 1.5);
  let tick = 0;
  const timer = setInterval(() => {
    data.fill(tick++ & 255);
    source.onFrame({ width: 1920, height: 1080, data });
  }, 33);
  return {
    track,
    stop: () => {
      clearInterval(timer);
      track.stop();
    },
  };
}

/** Returns the sharer's encoded frame count after 4 s of frames. */
async function runCase(label: string, shareAt: 'mid-call' | 'at join'): Promise<number> {
  console.log(label);
  const { managers, make } = pair();
  const src = screenSource();
  const sharer = shareAt === 'mid-call' ? 'A' : 'B';
  managers.A = make('A', 'B');
  managers.B = make('B', 'A', shareAt === 'at join' ? src.track : undefined);
  await managers.A.createConnection('B');
  if (shareAt === 'mid-call') {
    await sleep(1500);
    managers.A.setScreenTrack(src.track);
  }
  await sleep(4000);
  const encoded = await encodedFrames(managers[sharer], sharer === 'A' ? 'B' : 'A');
  console.log(`  encoded ${encoded} frames`);
  src.stop();
  managers.A.closeAll();
  managers.B.closeAll();
  return encoded;
}

async function main(): Promise<void> {
  const midCall = await runCase('A offerer (no webcam), shares mid-call', 'mid-call');
  const atJoin = await runCase('B already sharing, A connects as offerer (B answers with the track)', 'at join');
  check('a share started mid-call encodes', midCall > 0, true);
  check('a share present at join encodes', atJoin > 0, true);
  // The send budget rides in every remote description while sharing: the default 2500 kbps
  // for one receiver and an unknown shape, plus the 384 kbps audio allowance.
  check(
    'the sender writes its budget into the peer description',
    budgets.some((m) => /send budget to B: 2884 kbps/.test(m)),
    true,
  );
  finish();
}
main();
