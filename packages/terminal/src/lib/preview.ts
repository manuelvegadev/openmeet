import { type ChildProcess, spawn } from 'node:child_process';
import { ffmpegBin, ffplayBin } from './tool-path.js';

/**
 * A capture piped into a player window: what `--test-camera` and `--test-screen` show, and
 * what the camera picker previews. Returns the function that closes it — the caller owns the
 * lifetime, because a preview holds the device and on macOS a camera opens once (a capture
 * and its preview cannot both have it).
 *
 * `onClosed` fires when the window is closed or the capture ends by itself; `sawFrames` says
 * whether anything ever came through, which is how a caller walks to the next grabber.
 */
export function startPreview(
  captureArgs: string[],
  playerArgs: string[],
  onClosed?: (sawFrames: boolean) => void,
): () => void {
  const capture: ChildProcess = spawn(ffmpegBin(), captureArgs, { stdio: ['ignore', 'pipe', 'ignore'] });
  const player: ChildProcess = spawn(ffplayBin(), playerArgs, { stdio: ['pipe', 'ignore', 'ignore'] });
  let sawFrames = false;
  let done = false;
  capture.stdout?.once('data', () => {
    sawFrames = true;
  });
  capture.stdout?.pipe(player.stdin!);
  // Closing the window breaks the pipe before 'close' fires; not an error worth a stack trace.
  player.stdin?.on('error', () => {});

  const finish = () => {
    if (done) return;
    done = true;
    capture.kill();
    player.kill();
    onClosed?.(sawFrames);
  };
  player.on('close', finish);
  capture.on('close', finish);

  return () => {
    if (done) return;
    done = true;
    capture.kill();
    player.kill();
  };
}
