/** Boost Opus quality without enabling stereo. Adds maxaveragebitrate to
 *  request higher bitrate mono encoding from the remote peer. */
export function boostOpusQuality(sdp: string): string {
  return sdp.replace(/a=fmtp:(\d+) (.+)/g, (match, pt, params) => {
    if (params.includes('minptime')) {
      let modified = params;
      if (!modified.includes('maxaveragebitrate')) {
        modified += ';maxaveragebitrate=128000';
      }
      return `a=fmtp:${pt} ${modified}`;
    }
    return match;
  });
}
