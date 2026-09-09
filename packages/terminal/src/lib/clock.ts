/** `HH:MM`, or `HH:MM:SS` with `seconds`. */
export function formatClock(timestamp: number, seconds = false): string {
  const d = new Date(timestamp);
  const two = (n: number) => n.toString().padStart(2, '0');
  const hm = `${two(d.getHours())}:${two(d.getMinutes())}`;
  return seconds ? `${hm}:${two(d.getSeconds())}` : hm;
}

/**
 * Time in the room for the header: seconds for the first minute, then minutes, then hours
 * and minutes. Coarser as it grows so the header stops changing every second — every change
 * is a full frame written to the terminal.
 */
export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h${m.toString().padStart(2, '0')}m`;
  if (m > 0) return `${m}m`;
  return `${totalSec}s`;
}
