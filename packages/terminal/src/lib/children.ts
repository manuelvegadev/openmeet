import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process';

/**
 * The one gate every long-lived child process goes through — the ffmpeg captures, the ffplay
 * windows, the previews.
 *
 * It exists because a retry loop got past a bounded counter once (a camera that would not
 * open, reopened several times a second) and each turn of it spawned ffmpeg: the machine ran
 * out of memory and had to be power-cycled. Bounding that one loop fixed that one bug; this
 * bounds the *class*, so no future path — ours or a library's — can fork without limit no
 * matter how wrong its logic is.
 *
 * Three limits, all deliberately generous: they are a backstop, not a scheduler. A normal
 * call runs three or four children (one capture, one or two players), and a busy six-person
 * room with everyone's windows open still sits well under the ceiling.
 */
const MAX_LIVE = 12;
/** Spawns of one kind allowed inside `BURST_WINDOW_MS` before that kind is refused. */
const BURST = 6;
const BURST_WINDOW_MS = 10_000;
/** How long a kind stays refused once it has burnt its burst, or hit the ceiling. */
const COOLDOWN_MS = 30_000;

/** What a child is for. Limits are counted per kind, so a runaway camera cannot starve ffplay. */
export type ChildKind = 'webcam' | 'screen' | 'player' | 'preview';

/** One kind's budget: how many it has started in the window, and until when it is refused. */
interface Budget {
  count: number;
  windowStart: number;
  until: number;
}

const live = new Map<ChildProcess, ChildKind>();
const budgets = new Map<ChildKind, Budget>();
let onEvent: ((message: string) => void) | undefined;

process.once('exit', killAllChildren);

/** Where refusals are reported. The engine points this at its debug log. */
export function setChildLogger(log: (message: string) => void): void {
  onEvent = log;
}

function budgetFor(kind: ChildKind, now: number): Budget {
  const budget = budgets.get(kind) ?? { count: 0, windowStart: now, until: 0 };
  if (now - budget.windowStart > BURST_WINDOW_MS) {
    budget.count = 0;
    budget.windowStart = now;
  }
  budgets.set(kind, budget);
  return budget;
}

/**
 * Refuse this kind for a while, and say so once.
 *
 * Once, because the caller is usually a loop: the first version logged on every refusal, and
 * the log is an `appendFileSync` on the engine's audio loop (gotcha 25) — the original
 * symptom, moved somewhere worse. A refusal that repeats is silent until the cooldown ends.
 */
function refuse(kind: ChildKind, budget: Budget, now: number, why: string): null {
  if (now >= budget.until)
    onEvent?.(`Refusing to start ${kind}: ${why} — not trying again for ${COOLDOWN_MS / 1000} s`);
  budget.until = now + COOLDOWN_MS;
  budget.count = 0;
  budget.windowStart = now;
  return null;
}

/**
 * Spawn a child, or refuse. `null` means the limits said no, which every caller already has a
 * path for — a process can always fail to start — but it is a *temporary* no: the kind is on
 * cooldown and the next deliberate attempt will be allowed.
 */
export function spawnChild(kind: ChildKind, bin: string, args: string[], options: SpawnOptions): ChildProcess | null {
  const now = Date.now();
  const budget = budgetFor(kind, now);
  if (now < budget.until) return null;
  if (live.size >= MAX_LIVE)
    return refuse(kind, budget, now, `${live.size} child processes already running (${census()})`);
  if (budget.count >= BURST) {
    return refuse(kind, budget, now, `${BURST} attempts in ${BURST_WINDOW_MS / 1000} s`);
  }
  budget.count++;

  const proc = spawn(bin, args, options);
  live.set(proc, kind);
  proc.once('close', () => live.delete(proc));
  proc.once('error', () => live.delete(proc));
  return proc;
}

/**
 * A kind is starting again because a person asked for it, so its budget is forgiven. Retry
 * paths must never call this; that is the whole point of the budget.
 */
export function forgiveChildKind(kind: ChildKind): void {
  budgets.delete(kind);
}

/**
 * SIGTERM, then SIGKILL if it is still there, resolving when it is really gone. A camera or a
 * screen is not free until the process holding it has exited, so whoever wants the device next
 * waits on this rather than on a timer — and an avfoundation ffmpeg wedged inside
 * ScreenCaptureKit ignores the first signal (three were found alive at once on 2026-09-09).
 */
export function killChild(proc: ChildProcess, graceMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
    }, graceMs);
    proc.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    proc.kill();
  });
}

/** Everything still running, for the debug log. */
export function census(): string {
  if (live.size === 0) return 'no child processes';
  const byKind = new Map<ChildKind, number>();
  for (const kind of live.values()) byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  return [...byKind].map(([kind, n]) => `${kind} ×${n}`).join(', ');
}

export function liveChildCount(): number {
  return live.size;
}

/**
 * Kill everything on the way out, synchronously — a process that exits without this leaves its
 * ffmpeg holding the camera or the screen, and on macOS the next capture then fails to open.
 */
export function killAllChildren(): void {
  for (const proc of live.keys()) {
    try {
      proc.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  }
  live.clear();
}
