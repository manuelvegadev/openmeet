/** Enable stereo Opus at 192kbps. Adds stereo=1, sprop-stereo=1, and
 *  maxaveragebitrate=192000 to Opus fmtp lines for high-quality audio. */
export function boostOpusQuality(sdp: string): string {
  return sdp.replace(/a=fmtp:(\d+) (.+)/g, (match, pt, params) => {
    if (params.includes('minptime')) {
      let modified = params;
      if (!modified.includes('stereo')) {
        modified += ';stereo=1';
      }
      if (!modified.includes('sprop-stereo')) {
        modified += ';sprop-stereo=1';
      }
      if (!modified.includes('maxaveragebitrate')) {
        modified += ';maxaveragebitrate=192000';
      } else {
        modified = modified.replace(/maxaveragebitrate=\d+/, 'maxaveragebitrate=192000');
      }
      return `a=fmtp:${pt} ${modified}`;
    }
    return match;
  });
}
