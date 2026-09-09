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
export const WEBCAM_FRAME_BYTES = WEBCAM_WIDTH * WEBCAM_HEIGHT * 1.5; // I420

// Screen capture: 1080p@30 keeps the raw I420 pipe under ~93 MB/s. Higher rates overwhelm
// the engine's event loop, which also carries the 10 ms audio cadence.
export const SCREEN_MAX_WIDTH = 1920;
export const SCREEN_MAX_HEIGHT = 1080;
export const SCREEN_FPS = 30;
export const SCREEN_FRAME_BYTES = SCREEN_MAX_WIDTH * SCREEN_MAX_HEIGHT * 1.5; // I420

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

/**
 * ffmpeg arguments that capture `device` and emit exactly SCREEN_MAX_WIDTH x
 * SCREEN_MAX_HEIGHT @ SCREEN_FPS. A fixed output size keeps frame boundaries predictable;
 * scale+pad letterboxes whatever the screen's shape is. Retina/high-DPI screens capture at
 * physical pixels, so device.width/height only matter where the grabber needs a region
 * (x11grab, gdigrab).
 */
export function screenCaptureArgs(device: ScreenDevice): string[] {
  const fps = String(SCREEN_FPS);
  const scaleFilter = [
    `scale=${SCREEN_MAX_WIDTH}:${SCREEN_MAX_HEIGHT}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    `pad=${SCREEN_MAX_WIDTH}:${SCREEN_MAX_HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
  ].join(',');
  const output = ['-vf', scaleFilter, '-r', fps, ...RAW_OUTPUT];
  const size = `${device.width ?? SCREEN_MAX_WIDTH}x${device.height ?? SCREEN_MAX_HEIGHT}`;
  switch (platform()) {
    case 'darwin':
      return ['-f', 'avfoundation', '-capture_cursor', '1', '-framerate', fps, '-i', `${device.id}:none`, ...output];
    case 'win32': {
      // GDI capture of the virtual desktop; a region when the monitor's bounds are known.
      const region =
        device.width && device.height
          ? ['-offset_x', String(device.x ?? 0), '-offset_y', String(device.y ?? 0), '-video_size', size]
          : [];
      return ['-f', 'gdigrab', '-framerate', fps, '-draw_mouse', '1', ...region, '-i', 'desktop', ...output];
    }
    default:
      return ['-f', 'x11grab', '-framerate', fps, '-video_size', size, '-i', device.id, ...output];
  }
}

/** ffplay arguments that display raw I420 frames read from stdin. */
export function rawVideoPlayerArgs(width: number, height: number, fps: number, title: string): string[] {
  const size = `${width}x${height}`;
  return ['-f', 'rawvideo', '-pixel_format', 'yuv420p', '-video_size', size, '-framerate', String(fps)].concat([
    '-window_title',
    title,
    '-loglevel',
    'quiet',
    '-i',
    'pipe:0',
  ]);
}
