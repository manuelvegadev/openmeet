/**
 * ffmpeg / ffplay command lines shared by VideoManager (engine) and the CLI's
 * `--test-camera` / `--test-screen` previews, so a preview runs exactly what a call runs.
 * Kept free of wrtc so the TUI process can import it.
 */
import { platform } from 'node:os';
import type { ScreenDevice } from './devices.js';

// Webcam capture: 640x480@30 keeps the raw pipe small.
export const WEBCAM_WIDTH = 640;
export const WEBCAM_HEIGHT = 480;
export const WEBCAM_FPS = 30;
export const WEBCAM_FRAME_BYTES = i420FrameBytes(WEBCAM_WIDTH, WEBCAM_HEIGHT);

// Screen capture: 1080p@30 keeps the raw I420 pipe under ~93 MB/s. Higher rates overwhelm
// the engine's event loop, which also carries the 10 ms audio cadence.
export const SCREEN_MAX_WIDTH = 1920;
export const SCREEN_MAX_HEIGHT = 1080;
export const SCREEN_FPS = 30;
export const SCREEN_FRAME_BYTES = i420FrameBytes(SCREEN_MAX_WIDTH, SCREEN_MAX_HEIGHT);

/** Raw I420 on stdout, warnings only on stderr. */
const RAW_OUTPUT = ['-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-loglevel', 'warning', 'pipe:1'];

/**
 * ffmpeg arguments that capture the webcam at WEBCAM_WIDTH x WEBCAM_HEIGHT @ WEBCAM_FPS.
 * `null` where no webcam pipeline exists (Windows; see `platform.ts` `webcam`).
 */
export function webcamCaptureArgs(device?: string): string[] | null {
  const size = ['-framerate', String(WEBCAM_FPS), '-video_size', `${WEBCAM_WIDTH}x${WEBCAM_HEIGHT}`];
  switch (platform()) {
    case 'darwin':
      return ['-f', 'avfoundation', ...size, '-i', `${device ?? '0'}:none`, ...RAW_OUTPUT];
    case 'linux':
      return ['-f', 'v4l2', ...size, '-i', device ?? '/dev/video0', ...RAW_OUTPUT];
    default:
      return null;
  }
}

/** scale+pad to exactly SCREEN_MAX_WIDTH x SCREEN_MAX_HEIGHT, whatever the screen's shape. */
const LETTERBOX_1080P = [
  `scale=${SCREEN_MAX_WIDTH}:${SCREEN_MAX_HEIGHT}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
  `pad=${SCREEN_MAX_WIDTH}:${SCREEN_MAX_HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
].join(',');

/** Bytes in one I420 frame: a full-resolution Y plane plus two quarter-resolution planes. */
export function i420FrameBytes(width: number, height: number): number {
  return (width * height * 3) / 2;
}

/** The output tail every CPU-side grabber shares: letterbox, fix the rate, emit raw I420. */
function cpuOutput(fps: string): string[] {
  return ['-vf', LETTERBOX_1080P, '-r', fps, ...RAW_OUTPUT];
}

/**
 * ffmpeg argument sets that capture `device` and emit exactly SCREEN_MAX_WIDTH x
 * SCREEN_MAX_HEIGHT @ SCREEN_FPS, best first. A fixed output size keeps frame boundaries
 * predictable. Retina/high-DPI screens capture at physical pixels, so device.width/height
 * only matter where the grabber needs a region (x11grab, gdigrab).
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
  const size = `${device.width ?? SCREEN_MAX_WIDTH}x${device.height ?? SCREEN_MAX_HEIGHT}`;
  switch (platform()) {
    case 'darwin':
      return [
        ['-f', 'avfoundation', '-capture_cursor', '1', '-framerate', fps, '-i', `${device.id}:none`, ...cpuOutput(fps)],
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
        [
          '-f',
          'lavfi',
          '-i',
          `ddagrab=${dda}`,
          '-vf',
          `hwdownload,format=bgra,${LETTERBOX_1080P},format=yuv420p`,
          ...RAW_OUTPUT,
        ],
        ['-f', 'gdigrab', '-framerate', fps, '-draw_mouse', '1', ...region, '-i', 'desktop', ...cpuOutput(fps)],
      ];
    }
    default:
      return [['-f', 'x11grab', '-framerate', fps, '-video_size', size, '-i', device.id, ...cpuOutput(fps)]];
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
