/**
 * ffmpeg / ffplay command lines shared by VideoManager (engine) and the CLI's
 * `--test-camera` / `--test-screen` previews, so a preview runs exactly what a call runs.
 * Kept free of wrtc so the TUI process can import it.
 */
import { platform } from 'node:os';
import type { ScreenDevice } from './devices.js';

// Webcam capture: the camera's own aspect ratio with the height capped, the same rule the
// screen follows. A fixed 640x480 letterboxed every 16:9 camera — and most are; the Insta360
// Link here opens at 3840x2160 — spending a third of the frame, and the bandwidth behind it,
// on black. When the camera's shape is unknown the caps themselves are the fallback, because
// the pipe reader must know the frame size before the first byte.
export const WEBCAM_MAX_HEIGHT = 720;
export const WEBCAM_MAX_WIDTH = 1280;
export const WEBCAM_FPS = 30;

/** One capture mode a camera declares. */
export interface CameraMode {
  width: number;
  height: number;
  fps: number;
}

/**
 * Which of a camera's modes to *aim* for — its shape, not a demand.
 *
 * Pinning the mode with `-video_size` is cheaper on paper and unusable in practice: ffmpeg's
 * avfoundation input keeps the geometry it negotiated at open time, so when anything else
 * changes the device's format — the Insta360 Link Controller switching 720 to 1080, another
 * app opening the camera larger — it goes on reading the new buffers with the old stride and
 * the picture comes out combed and repeated. Reproduced here by forcing 4K from a second
 * capture while ours ran pinned at 720; unpinned, the same test stays clean.
 *
 * So the camera is opened however it likes and the frames are scaled, and what this mode is
 * for is the *shape*: the aspect ratio to send, so a 16:9 camera is not letterboxed into 4:3.
 * The scaling is paid for with a cheap scaler rather than a pinned mode (see RAW_OUTPUT).
 */
export function pickWebcamMode(modes: CameraMode[]): CameraMode | undefined {
  const area = (m: CameraMode) => m.width * m.height;
  const covering = modes.filter((m) => m.height >= WEBCAM_MAX_HEIGHT);
  // Among the modes that cover the cap, the smallest; if none does, the largest there is.
  const pool = covering.length > 0 ? covering : modes;
  const better = covering.length > 0 ? (a: number, b: number) => a < b : (a: number, b: number) => a > b;
  return pool.reduce<CameraMode | undefined>((best, m) => (!best || better(area(m), area(best)) ? m : best), undefined);
}

export interface Size {
  width: number;
  height: number;
}

/**
 * A shape fitted under two caps: never enlarged, its aspect ratio kept, both sides even —
 * I420 needs even sides, and the pad in the filter chain relies on the size being exact. The
 * webcam and the screen differ only in which caps they pass.
 */
function fitUnderCaps(width: number, height: number, maxWidth: number, maxHeight: number): Size {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** The size a camera goes out at. Unknown shape → the caps, which is what it is letterboxed into. */
export function webcamOutputSize(mode?: CameraMode): Size {
  if (!mode) return { width: WEBCAM_MAX_WIDTH, height: WEBCAM_MAX_HEIGHT };
  return fitUnderCaps(mode.width, mode.height, WEBCAM_MAX_WIDTH, WEBCAM_MAX_HEIGHT);
}

// Screen capture: the short side is capped at 1080 and the long side at 3840, at 30 fps, and
// the shape is the screen's own — a 3440x1440 ultrawide goes out as 2580x1080, not as
// 1920x804 with 138 px of black above and below. 1080p keeps the raw I420 pipe near 93 MB/s;
// an ultrawide is a third more, still well inside what the engine's loop carried at 1080p
// (docs/performance.md). Higher rates overwhelm that loop, which also carries the 10 ms
// audio cadence. `SCREEN_FALLBACK_*` is the fixed, padded shape used only when the screen's
// size is unknown, because the pipe reader must know the frame size before the first byte.
export const SCREEN_MAX_SHORT_SIDE = 1080;
export const SCREEN_MAX_LONG_SIDE = 3840;
export const SCREEN_FALLBACK_WIDTH = 1920;
export const SCREEN_FALLBACK_HEIGHT = 1080;
export const SCREEN_FPS = 30;

/**
 * The size a screen goes out at: its own aspect ratio, fitted under the caps, never
 * enlarged, both sides even (I420 needs it). Unknown size → the padded 1080p fallback.
 */
export function screenOutputSize(device: Pick<ScreenDevice, 'width' | 'height'>): Size {
  const { width, height } = device;
  if (!width || !height) return { width: SCREEN_FALLBACK_WIDTH, height: SCREEN_FALLBACK_HEIGHT };
  // The caps are by short and long side rather than by width and height, so a portrait screen
  // is bounded the same way a landscape one is.
  const portrait = height > width;
  const maxWidth = portrait ? SCREEN_MAX_SHORT_SIDE : SCREEN_MAX_LONG_SIDE;
  const maxHeight = portrait ? SCREEN_MAX_LONG_SIDE : SCREEN_MAX_SHORT_SIDE;
  return fitUnderCaps(width, height, maxWidth, maxHeight);
}

/**
 * `fast_bilinear` for the webcam's downscale: the default scaler costs 2.24 s of CPU per 5 s
 * of capture from a 4K camera, this one 1.14 s — the same as pinning the camera's mode did,
 * without the corruption that pinning brings (see `pickWebcamMode`). Softer on a 3x downscale,
 * which a webcam can afford.
 */
const WEBCAM_SCALER = ['-sws_flags', 'fast_bilinear'];

/** Raw I420 on stdout, warnings only on stderr. */
const RAW_OUTPUT = ['-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-loglevel', 'warning', 'pipe:1'];

/**
 * ffmpeg arguments that deliver the webcam at exactly WEBCAM_WIDTH x WEBCAM_HEIGHT @
 * WEBCAM_FPS. `null` where no webcam pipeline exists (Windows; see `platform.ts` `webcam`).
 *
 * The size is a filter, not a request: asking avfoundation for `-video_size 640x480` fails
 * outright on a camera that has no such mode — an Insta360 Link answers `Input/output error`
 * and ffmpeg exits before a frame — and the caller cannot know a device's modes without
 * probing it. So the camera opens at whatever it likes and the frames are scaled and
 * letterboxed here, which is what the screen path already does. The frame rate *is* asked
 * for: without `-framerate` avfoundation fails the same way (verified on this Mac, both
 * ways round).
 */
export function webcamCaptureArgs(device: string | undefined, size: Size): string[] | null {
  // The rate is asked for — without it avfoundation fails outright — but never the size: see
  // `pickWebcamMode` for what pinning it costs. Always 30, never the mode's own rate: a camera
  // whose best mode says 15 is exactly the case avfoundation rejects (gotcha 12).
  const rate = ['-framerate', String(WEBCAM_FPS)];
  // `fps` before the scaling, not just `-framerate` on the input: asking the camera for 30 is
  // a request it need not honour, and when its timestamps do not match, ffmpeg duplicates
  // frames to fill the gap — measured at ~119,000 fps out of an Insta360 Link, which freezes
  // a player and would bury the engine's event loop. The filter paces the output whatever the
  // camera does. (The screen path must *not* have this: gotcha 28.)
  const fit = ['-vf', `fps=${WEBCAM_FPS},${fitTo(size.width, size.height)}`];
  switch (platform()) {
    case 'darwin':
      return ['-f', 'avfoundation', ...rate, '-i', `${device ?? '0'}:none`, ...fit, ...WEBCAM_SCALER, ...RAW_OUTPUT];
    case 'linux':
      return ['-f', 'v4l2', ...rate, '-i', device ?? '/dev/video0', ...fit, ...WEBCAM_SCALER, ...RAW_OUTPUT];
    default:
      return null;
  }
}

/**
 * scale+pad to exactly `width` x `height`. The pad stays even though the size already has the
 * screen's aspect: if the grabber delivers a different shape than the enumeration promised
 * (a display that changed mode, a Retina factor, an RDP session), the frames still come out
 * at exactly the size the pipe reader is slicing at — letterboxed rather than corrupted.
 */
function fitTo(width: number, height: number): string {
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
  ].join(',');
}

/** Bytes in one I420 frame: a full-resolution Y plane plus two quarter-resolution planes. */
export function i420FrameBytes(width: number, height: number): number {
  return (width * height * 3) / 2;
}

/** The output tail every CPU-side grabber shares: fit, fix the rate, emit raw I420. */
function cpuOutput(fps: string, fit: string): string[] {
  return ['-vf', fit, '-r', fps, ...RAW_OUTPUT];
}

/**
 * ffmpeg argument sets that capture `device` and emit exactly `screenOutputSize(device)` @
 * SCREEN_FPS, best first. A fixed output size per share keeps frame boundaries predictable.
 * Retina/high-DPI screens capture at physical pixels; the fit handles that, and
 * device.width/height also matter where the grabber needs a region (x11grab, gdigrab).
 *
 * More than one candidate means the preferred grabber can fail in a way we cannot detect up
 * front, so the caller walks the list when one produces no frames. That is the case on
 * Windows: the Desktop Duplication API reads the desktop from the GPU and — with
 * `dup_frames=false` — hands over a frame only when something actually changed (measured at
 * 1080p on an RTX 2080 SUPER: 41% of a core duplicating, 3% not), but it needs a real GPU
 * output. Inside an RDP session it fails with "Failed to enumerate DXGI output 0" while
 * gdigrab captures that session fine — at the old cost, which beats not at all.
 */
export function screenCaptureCandidates(device: ScreenDevice): string[][] {
  const fps = String(SCREEN_FPS);
  const size = `${device.width ?? SCREEN_FALLBACK_WIDTH}x${device.height ?? SCREEN_FALLBACK_HEIGHT}`;
  const out = screenOutputSize(device);
  const fit = fitTo(out.width, out.height);
  switch (platform()) {
    case 'darwin':
      return [
        [
          '-f',
          'avfoundation',
          '-capture_cursor',
          '1',
          '-framerate',
          fps,
          '-i',
          `${device.id}:none`,
          ...cpuOutput(fps, fit),
        ],
      ];
    case 'win32': {
      const dda = [
        `output_idx=${device.outputIndex ?? 0}`,
        `framerate=${fps}`,
        'draw_mouse=1',
        'dup_frames=false',
      ].join(':');
      // GPU scaling is not reachable from ddagrab on current ffmpeg builds — scale_d3d11
      // fails to allocate its output texture, and neither CUDA nor Vulkan interop is
      // implemented — so the colour conversion is downloaded and done on the CPU. And no
      // `-r`: it would restore the frame duplication `dup_frames=false` just avoided.
      const region =
        device.width && device.height
          ? ['-offset_x', String(device.x ?? 0), '-offset_y', String(device.y ?? 0), '-video_size', size]
          : [];
      return [
        ['-f', 'lavfi', '-i', `ddagrab=${dda}`, '-vf', `hwdownload,format=bgra,${fit},format=yuv420p`, ...RAW_OUTPUT],
        ['-f', 'gdigrab', '-framerate', fps, '-draw_mouse', '1', ...region, '-i', 'desktop', ...cpuOutput(fps, fit)],
      ];
    }
    default:
      return [['-f', 'x11grab', '-framerate', fps, '-video_size', size, '-i', device.id, ...cpuOutput(fps, fit)]];
  }
}

/**
 * How big the player's window opens. The stream keeps its own resolution — this only caps
 * the window, because a 1080p share on a 1080p monitor opens edge to edge and pushes its own
 * title bar off the screen. Downscale only: a 640x480 webcam should not be blown up.
 */
const MAX_WINDOW_WIDTH = 1280;
const MAX_WINDOW_HEIGHT = 720;

/** Window size for a `width`x`height` stream, fitted into the cap without distorting it. */
export function playerWindowSize(width: number, height: number): [number, number] {
  const scale = Math.min(1, MAX_WINDOW_WIDTH / width, MAX_WINDOW_HEIGHT / height);
  return [Math.max(2, Math.round(width * scale)), Math.max(2, Math.round(height * scale))];
}

/** ffplay arguments that display raw I420 frames read from stdin. */
export function rawVideoPlayerArgs(width: number, height: number, fps: number, title: string): string[] {
  const [windowWidth, windowHeight] = playerWindowSize(width, height);
  return [
    '-f',
    'rawvideo',
    '-pixel_format',
    'yuv420p',
    '-video_size',
    `${width}x${height}`,
    '-framerate',
    String(fps),
    // ffplay scales the stream to the window itself, so this costs nothing.
    '-x',
    String(windowWidth),
    '-y',
    String(windowHeight),
    '-window_title',
    title,
    '-loglevel',
    'quiet',
    '-i',
    'pipe:0',
  ];
}
