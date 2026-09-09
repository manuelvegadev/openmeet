/**
 * Opus negotiation.
 *
 * Per RFC 7587 `maxaveragebitrate` is a *receive* declaration: it tells the other side
 * what its encoder may spend when sending to us. So the two directions live in two
 * different places — our own description carries the ceiling for what we receive, and the
 * peer's description is what our encoder reads, which is where our send ceiling goes.
 * Neither can be changed without renegotiating: `setParameters` is rejected by
 * @roamhq/wrtc once a sender has an SSRC.
 */

/** 128 kbps stereo is transparent for speech and good for music; 256 was twice the uplink for no audible gain. */
export const DEFAULT_AUDIO_KBPS = 128;
export const AUDIO_KBPS_MIN = 16;
export const AUDIO_KBPS_MAX = 512;
/** What the settings screen cycles through; the CLI accepts any value in range. */
export const AUDIO_KBPS_STEPS = [64, 96, 128, 192, 256] as const;

/** `--audio-send-kbps` / `--audio-receive-kbps` value → kbps, or null when it is not one. */
export function parseAudioKbpsFlag(value: string): number | null {
  const kbps = Number(value);
  return Number.isFinite(kbps) && kbps >= AUDIO_KBPS_MIN && kbps <= AUDIO_KBPS_MAX ? Math.round(kbps) : null;
}

/** Payload type of the Opus line, or null when the description has no Opus. */
function opusPayloadType(sdp: string): string | null {
  return /a=rtpmap:(\d+) opus\/48000\/2/i.exec(sdp)?.[1] ?? null;
}

/** The fmtp line for `pt` — matcher and current parameters, so the line format lives in one place. */
function fmtpLine(pt: string): RegExp {
  return new RegExp(`^a=fmtp:${pt} ([^\\r\\n]*)$`, 'm');
}

/** Rewrite the fmtp line for `pt`, adding or replacing each of `params`. */
function setFmtpParams(sdp: string, pt: string, params: Record<string, string | number>): string {
  const line = fmtpLine(pt);
  if (!line.test(sdp)) {
    // No fmtp for this payload type yet — Opus always has one in practice, but be safe.
    const entries = Object.entries(params).map(([k, v]) => `${k}=${v}`);
    return sdp.replace(new RegExp(`^(a=rtpmap:${pt} [^\\r\\n]*)$`, 'm'), `$1\r\na=fmtp:${pt} ${entries.join(';')}`);
  }
  return sdp.replace(line, (_full, existing: string) => {
    let out = existing;
    for (const [key, value] of Object.entries(params)) {
      const kv = `${key}=${value}`;
      const present = new RegExp(`${key}=[^;]*`);
      out = present.test(out) ? out.replace(present, kv) : `${out};${kv}`;
    }
    return `a=fmtp:${pt} ${out}`;
  });
}

/**
 * Our own local description: we send stereo, and peers may spend up to `receiveKbps`
 * encoding for us.
 */
export function boostOpusQuality(sdp: string, receiveKbps: number = DEFAULT_AUDIO_KBPS): string {
  const pt = opusPayloadType(sdp);
  if (!pt) return sdp;
  return setFmtpParams(sdp, pt, {
    stereo: 1,
    'sprop-stereo': 1,
    maxaveragebitrate: Math.round(receiveKbps * 1000),
  });
}

/**
 * The remote description, before `setRemoteDescription`. Our encoder reads its
 * `maxaveragebitrate` as a ceiling, so lowering it here bounds what we send without
 * touching what the peer is willing to receive from anyone else.
 */
export function capOutgoingAudioBitrate(sdp: string, sendKbps: number): string {
  const pt = opusPayloadType(sdp);
  if (!pt) return sdp;
  const current = fmtpLine(pt).exec(sdp);
  const theirCeiling = current ? Number(/maxaveragebitrate=(\d+)/.exec(current[1])?.[1] ?? 0) : 0;
  const ours = Math.round(sendKbps * 1000);
  // Never raise a peer's stated limit — only lower it to our own.
  const target = theirCeiling > 0 ? Math.min(theirCeiling, ours) : ours;
  return setFmtpParams(sdp, pt, { maxaveragebitrate: target });
}

/**
 * Put Opus RED ahead of bare Opus in the audio m-line.
 *
 * RED carries the previous frame alongside the current one, so a single lost packet is
 * reconstructed instead of concealed. libwebrtc offers `red/48000/2` already — it just is
 * not the preferred payload type unless the m-line says so. Costs roughly one extra frame
 * of bitrate; buys immunity to isolated loss, which is what makes voice sound chopped.
 */
export function preferAudioRed(sdp: string): string {
  const opusPt = opusPayloadType(sdp);
  if (!opusPt) return sdp;
  const redPt = /a=rtpmap:(\d+) red\/48000\/2/i.exec(sdp)?.[1];
  // Only the RED that wraps *this* Opus payload; the fmtp names what it protects.
  if (!redPt || !new RegExp(`^a=fmtp:${redPt} ${opusPt}/${opusPt}$`, 'm').test(sdp)) return sdp;

  return sdp.replace(/^m=audio ([^\r\n]+)$/m, (full, rest: string) => {
    const parts = rest.split(' ');
    if (parts.length < 3) return full;
    const [port, proto, ...payloads] = parts;
    if (payloads[0] === redPt) return full;
    return `m=audio ${port} ${proto} ${[redPt, ...payloads.filter((p) => p !== redPt)].join(' ')}`;
  });
}

/**
 * Force `a=sendrecv` on the screen m-line (the second video section).
 *
 * @roamhq/wrtc does not always reflect a transceiver direction change in the SDP it
 * generates, so a renegotiation that starts a screen share can go out still marked
 * `recvonly` and the peer never subscribes. Returns the SDP unchanged when it was already
 * right, so the caller can tell whether it had to intervene.
 */
export function forceScreenSendrecv(sdp: string): string {
  let videoSections = 0;
  return sdp
    .split(/(?=m=)/)
    .map((section) => {
      if (!section.startsWith('m=video')) return section;
      videoSections++;
      if (videoSections !== 2 || section.includes('a=sendrecv')) return section;
      return section.replace(/a=recvonly|a=inactive/, 'a=sendrecv');
    })
    .join('');
}
