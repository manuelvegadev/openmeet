/**
 * Debug diagnostics shared by the TUI and engine processes.
 *
 * `--debug` shows events in the TUI and writes `debug.log`; `OPENMEET_LOG=1` writes the
 * log file without the in-TUI feed (useful for measuring without the render load the feed
 * itself adds). Both processes read the same predicate.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';

export function fileLoggingEnabled(): boolean {
  return process.env.OPENMEET_LOG === '1';
}

/** Whether diagnostics (log file, loop/render metrics) should run at all. */
export function diagnosticsEnabled(debug: boolean): boolean {
  return debug || fileLoggingEnabled();
}

/**
 * Sample event-loop delay and report p50/p99/max every `intervalMs`. The audio path lives
 * on the engine's loop and rendering on the TUI's; the same metric on both makes them
 * comparable in one log. Returns a disposer.
 */
export function startLoopDelayMonitor(label: string, log: (line: string) => void, intervalMs = 10_000): () => void {
  const h = monitorEventLoopDelay({ resolution: 5 });
  h.enable();
  const ms = (n: number) => (n / 1e6).toFixed(1);
  const timer = setInterval(() => {
    log(`${label} loop delay: p50 ${ms(h.percentile(50))}ms p99 ${ms(h.percentile(99))}ms max ${ms(h.max)}ms`);
    h.reset();
  }, intervalMs);
  return () => {
    clearInterval(timer);
    h.disable();
  };
}

// ─── Ink render timings (TUI process) ────────────────────────────────

let renderDurations: number[] = [];

/** Pass as Ink's `onRender` option. */
export function recordRender(metrics: { renderTime: number }): void {
  renderDurations.push(metrics.renderTime);
  if (renderDurations.length > 2000) renderDurations = renderDurations.slice(-1000);
}

/** Summarize and reset. Returns null when nothing was rendered. */
export function drainRenderStats(): { count: number; p50: number; p99: number; max: number } | null {
  if (renderDurations.length === 0) return null;
  const sorted = [...renderDurations].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const stats = { count: sorted.length, p50: pick(0.5), p99: pick(0.99), max: sorted[sorted.length - 1] };
  renderDurations = [];
  return stats;
}

export function formatRenderStats(r: NonNullable<ReturnType<typeof drainRenderStats>>): string {
  return `Ink render: ${r.count} frames, p50 ${r.p50.toFixed(1)}ms p99 ${r.p99.toFixed(1)}ms max ${r.max.toFixed(1)}ms`;
}
