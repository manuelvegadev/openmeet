/**
 * Where ffmpeg and ffplay are, resolved once per process.
 *
 * `spawn('ffmpeg')` trusts the PATH of whatever launched us, and on Windows that PATH is
 * often stale: Explorer captures the environment when it starts and never re-reads it, so a
 * shortcut opened after `winget install Gyan.FFmpeg` — which is what install.ps1 runs — can
 * still not see `%LOCALAPPDATA%\Microsoft\WinGet\Links`. That is exactly how the Windows
 * test box lost video: `where ffmpeg` failed in the shortcut's window while succeeding over
 * SSH. So after the PATH, look where the installers we know of put the binaries.
 */
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';

const resolved = new Map<string, string | null>();

/** Directories to try after the PATH. Windows only; on macOS/Linux the PATH is the truth. */
function knownInstallDirs(): string[] {
  if (platform() !== 'win32') return [];
  const dirs: string[] = [];
  if (process.env.LOCALAPPDATA) dirs.push(join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
  for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
    if (root) dirs.push(join(root, 'ffmpeg', 'bin'));
  }
  return dirs;
}

const WHICH = platform() === 'win32' ? 'where' : 'which';

function firstLine(out: string): string | null {
  return (
    out
      .split(/\r?\n/)
      .find((line) => line.trim() !== '')
      ?.trim() ?? null
  );
}

function fromInstallDirs(tool: string): string | null {
  for (const dir of knownInstallDirs()) {
    const candidate = join(dir, `${tool}.exe`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function lookup(tool: string): string | null {
  try {
    const out = execFileSync(WHICH, [tool], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const found = firstLine(out);
    if (found) return found;
  } catch {
    // Not on the PATH; keep looking.
  }
  return fromInstallDirs(tool);
}

/**
 * Absolute path, or null when `tool` is nowhere we know to look. Cached per process. The
 * lookup is synchronous (one `where`/`which` spawn), which is fine in the TUI at startup;
 * the engine calls `warmTools()` instead so it never blocks next to live audio.
 */
export function findTool(tool: string): string | null {
  if (!resolved.has(tool)) resolved.set(tool, lookup(tool));
  return resolved.get(tool) ?? null;
}

/** Resolve `tools` without blocking and fill the cache, so later `findTool` calls are free. */
export function warmTools(tools: string[] = ['ffmpeg', 'ffplay']): Promise<Record<string, string | null>> {
  return Promise.all(
    tools.map(
      (tool) =>
        new Promise<[string, string | null]>((resolve) => {
          if (resolved.has(tool)) return resolve([tool, resolved.get(tool) ?? null]);
          execFile(WHICH, [tool], { encoding: 'utf-8', windowsHide: true }, (err, out) => {
            const found = (!err && firstLine(out)) || fromInstallDirs(tool);
            resolved.set(tool, found);
            resolve([tool, found]);
          });
        }),
    ),
  ).then((entries) => Object.fromEntries(entries));
}

/** What to `spawn`. Falls back to the bare name so a missing tool still fails loudly at spawn. */
export function ffmpegBin(): string {
  return findTool('ffmpeg') ?? 'ffmpeg';
}

export function ffplayBin(): string {
  return findTool('ffplay') ?? 'ffplay';
}
