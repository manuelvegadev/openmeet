/**
 * One way to run a PowerShell one-liner. ~1 s of startup on Windows, so callers cache or
 * prefetch; the preamble and the exec options are policy that used to live in three files.
 */
import { execFile } from 'node:child_process';

export const POWERSHELL = 'powershell';

export function powershellArgs(script: string): string[] {
  return ['-NoProfile', '-NonInteractive', '-Command', script];
}

/** Resolves with stdout, or null when PowerShell failed or timed out. Never rejects. */
export function runPowerShell(script: string, timeoutMs = 10_000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(POWERSHELL, powershellArgs(script), { windowsHide: true, timeout: timeoutMs }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}
