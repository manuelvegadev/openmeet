/**
 * Device-free check of the screen output size — the shape a share goes out at:
 * pnpm --filter openmeet-terminal exec tsx scripts/screen-size-test.ts
 *
 * The rule: the screen's own aspect ratio, short side ≤ 1080, long side ≤ 3840, never
 * enlarged, both sides even. Getting it wrong is silent in two directions — black bars that
 * waste pixels, or a frame size the pipe reader slices wrongly — so it is worth pinning.
 */
import { screenCaptureCandidates, screenOutputSize } from '../src/lib/capture-args.js';
import { check, finish } from './harness.js';

const size = (w?: number, h?: number) => {
  const s = screenOutputSize({ width: w, height: h });
  return `${s.width}x${s.height}`;
};

check('1080p stays 1080p', size(1920, 1080), '1920x1080');
check('a 3440x1440 ultrawide keeps its shape at 1080 tall', size(3440, 1440), '2580x1080');
check('the M4 Pro display (3096x1296) likewise', size(3096, 1296), '2580x1080');
check('a 5120x1440 super-ultrawide hits the long-side cap exactly', size(5120, 1440), '3840x1080');
check('wider still is scaled by the long side, not the short one', size(7680, 2160), '3840x1080');
check('4K UHD comes down to 1080p', size(3840, 2160), '1920x1080');
check('a 16:10 panel keeps 16:10', size(2560, 1600), '1728x1080');
check('a portrait monitor gets 1080 wide and its full height', size(1080, 1920), '1080x1920');
check('a small screen is never enlarged', size(1366, 768), '1366x768');
check('odd dimensions are rounded to even', size(1367, 769), '1368x770');
check('no size known: the padded 1080p fallback', size(undefined, undefined), '1920x1080');
check('no height known: the fallback too', size(3440, undefined), '1920x1080');

// The ffmpeg filter must ask for exactly that size, on this platform's grabber.
const args = screenCaptureCandidates({ id: '0', name: 'test', width: 3440, height: 1440 }).flat().join(' ');
check('the filter scales to the computed size', /scale=2580:1080:/.test(args), true);
check('...and pads to it, so a surprise shape is letterboxed, never mis-sliced', /pad=2580:1080:/.test(args), true);

finish();
