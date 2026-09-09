/**
 * Device-free check of the Opus negotiation helpers, against SDP that wrtc actually
 * generates: pnpm --filter openmeet-terminal exec tsx scripts/sdp-test.ts
 *
 * The two directions live in different descriptions, and getting that backwards would be
 * silent — both sides would still connect, just at the wrong bitrate — so it is worth a test.
 */
import wrtc from '@roamhq/wrtc';
import {
  boostOpusQuality,
  capOutgoingAudioBitrate,
  DEFAULT_AUDIO_KBPS,
  forceScreenSendrecv,
  preferAudioRed,
} from '../src/lib/sdp.js';

const line = (sdp: string, re: RegExp): string => re.exec(sdp)?.[0] ?? '(absent)';
const fmtp = (sdp: string) => line(sdp, /^a=fmtp:111 [^\r\n]+$/m);
const mAudio = (sdp: string) => line(sdp, /^m=audio [^\r\n]+$/m);

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) console.log(`       expected ${expected}\n       actual   ${actual}`);
}

async function main(): Promise<void> {
  const pc = new (wrtc as any).RTCPeerConnection({ iceServers: [] });
  pc.addTransceiver('audio', { direction: 'sendrecv' });
  const offer = await pc.createOffer();
  const raw: string = offer.sdp;
  pc.close();

  console.log(`raw    ${mAudio(raw)}`);
  console.log(`raw    ${fmtp(raw)}\n`);

  const local = boostOpusQuality(preferAudioRed(raw), DEFAULT_AUDIO_KBPS);
  console.log(`local  ${mAudio(local)}`);
  console.log(`local  ${fmtp(local)}\n`);

  const redPt = /a=rtpmap:(\d+) red\/48000\/2/.exec(raw)?.[1];
  check('RED is offered by wrtc at all', typeof redPt, 'string');
  check('RED becomes the preferred payload type', mAudio(local).split(' ')[3], redPt);
  check('inband FEC is left on', local.includes('useinbandfec=1'), true);
  check('stereo is advertised', local.includes('stereo=1;sprop-stereo=1'), true);
  check('receive ceiling is our default', local.includes(`maxaveragebitrate=${DEFAULT_AUDIO_KBPS * 1000}`), true);
  check('reordering twice changes nothing', preferAudioRed(local), local);

  const capped = capOutgoingAudioBitrate(local, 64);
  console.log(`\ncapped ${fmtp(capped)}`);
  check('send ceiling lowers the peer-declared limit', capped.includes('maxaveragebitrate=64000'), true);

  const raised = capOutgoingAudioBitrate(local, 512);
  check('send ceiling never raises it above the peer', raised.includes('maxaveragebitrate=128000'), true);

  const videoOnly = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n';
  check('an SDP without Opus is left alone', boostOpusQuality(preferAudioRed(videoOnly)), videoOnly);

  // The screen m-line is the second video section; the webcam one must not be touched.
  const twoVideo =
    'v=0\r\n' +
    'm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:1\r\na=recvonly\r\n' +
    'm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:2\r\na=recvonly\r\n';
  const forced = forceScreenSendrecv(twoVideo);
  check('the screen m-line is forced to sendrecv', /a=mid:2\r\na=sendrecv/.test(forced), true);
  check('the webcam m-line is left alone', /a=mid:1\r\na=recvonly/.test(forced), true);
  check('forcing twice changes nothing', forceScreenSendrecv(forced), forced);

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
