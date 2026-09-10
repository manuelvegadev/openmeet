import { killChild, spawnChild } from './children.js';
import { ffmpegBin, ffplayBin } from './tool-path.js';

/** How a preview ended, which is all a caller needs to say something useful about it. */
export interface PreviewResult {
  /** Anything came through at all. */
  sawFrames: boolean;
  /** Which side went first: the window being closed is how a preview is meant to end. */
  closedBy: 'capture' | 'player';
  /** The last line either process complained about, when there is one. */
  error?: string;
}

/** ffmpeg is chatty about formats; only the lines that read like a failure are worth keeping. */
function lastComplaint(text: string): string | undefined {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /error|unable|failed|denied|not found|no such|invalid|permission/i.test(l));
  return lines.at(-1)?.slice(0, 120);
}

/**
 * A capture piped into a player window: what `--test-camera` and `--test-screen` show, and
 * what the camera picker previews. Returns the function that closes it — the caller owns the
 * lifetime, because a preview holds the device and on macOS a camera opens once (a capture
 * and its preview cannot both have it).
 *
 * Both processes' stderr is kept rather than dropped. A preview that shows nothing is the
 * failure people actually hit, and "no picture" is a useless thing to be told when ffmpeg or
 * ffplay said exactly what was wrong — and which of the two it was.
 */
export function startPreview(
  captureArgs: string[],
  playerArgs: string[],
  onClosed?: (result: PreviewResult) => void,
): () => void {
  // The window counts as a `player`, not a second `preview`: charging both to one budget made
  // every third preview in ten seconds trip a cooldown that nothing forgives.
  const capture = spawnChild('preview', ffmpegBin(), captureArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  const player = capture ? spawnChild('player', ffplayBin(), playerArgs, { stdio: ['pipe', 'ignore', 'pipe'] }) : null;
  if (!capture || !player) {
    if (capture) void killChild(capture, 300);
    onClosed?.({ sawFrames: false, closedBy: 'capture', error: 'too many child processes; try again in a moment' });
    return () => {};
  }
  let sawFrames = false;
  let done = false;
  let captureErr = '';
  let playerErr = '';
  capture.stderr?.on('data', (d) => {
    captureErr += d.toString();
  });
  player.stderr?.on('data', (d) => {
    playerErr += d.toString();
  });
  capture.stdout?.once('data', () => {
    sawFrames = true;
  });
  capture.stdout?.pipe(player.stdin!);
  // Closing the window breaks the pipe before 'close' fires; not an error worth a stack trace.
  player.stdin?.on('error', () => {});

  const finish = (closedBy: 'capture' | 'player') => {
    if (done) return;
    done = true;
    void killChild(capture, 300);
    void killChild(player, 300);
    onClosed?.({
      sawFrames,
      closedBy,
      error:
        closedBy === 'capture' ? lastComplaint(captureErr) : (lastComplaint(playerErr) ?? lastComplaint(captureErr)),
    });
  };
  player.on('close', () => finish('player'));
  capture.on('close', () => finish('capture'));
  capture.on('error', () => finish('capture'));
  player.on('error', () => finish('player'));

  return () => {
    if (done) return;
    done = true;
    void killChild(capture, 300);
    void killChild(player, 300);
  };
}
