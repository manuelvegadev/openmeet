/**
 * Staying up to date without asking, and without getting in the way.
 *
 * The shape is forced by two facts. The app is an npm global install with native modules
 * (`audify`, `@roamhq/wrtc`), so an update is `npm install -g` and not a file copy; and the
 * engine process holds those `.node` files open from launch to exit, so on Windows npm
 * cannot replace the directory while we are running. Hence Chrome's shape: pull the tarball
 * into npm's cache while the app runs — `npm cache add` touches nothing that is loaded — and
 * install once it is over, either because someone pressed `r` (foreground, then relaunch) or
 * because they quit (detached, ready for the next launch).
 *
 * The notice only ever claims what is true: it appears when the download is already done, so
 * "restart to install" is a promise we can keep offline.
 *
 * Everything here runs in the TUI process. The engine never imports it.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import { platform } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { APP_VERSION } from '../version.js';
import { CONFIG_DIR, loadSettings, saveSettings } from './settings.js';

export const PACKAGE_NAME = 'openmeet-terminal';
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
/** The check is best-effort and must never delay a launch: three seconds or nothing. */
const CHECK_TIMEOUT_MS = 3000;
/** How often we ask the registry. In between, the last answer stands (settings). */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const NPM_TIMEOUT_MS = 5 * 60 * 1000;
/** What the detached installer writes, since by then there is no terminal to write to. */
export const UPDATE_LOG = join(CONFIG_DIR, 'update.log');

export const UPDATE_POLICIES = ['auto', 'notify', 'off'] as const;
export type UpdatePolicy = (typeof UPDATE_POLICIES)[number];

export interface UpdateStatus {
  /** The newer version on the registry. */
  version: string;
  /** The tarball is in npm's cache and the install directory is ours: `r` will work. */
  ready: boolean;
  /** Set instead of `ready` when the install is not ours to do — a root-owned prefix. */
  command?: string;
}

const isWindows = platform() === 'win32';

/** `1.2.10` > `1.2.9`, and a prerelease is older than the release it leads to. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parts = (v: string): [number[], boolean] => {
    const [core, pre] = v.split('-', 2);
    const nums = core.split('.').map((n) => Number.parseInt(n, 10));
    return [nums, pre !== undefined];
  };
  const [a, aPre] = parts(candidate);
  const [b, bPre] = parts(current);
  if (a.some(Number.isNaN) || b.some(Number.isNaN) || a.length !== 3 || b.length !== 3) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  // Same numbers: a release beats the prerelease of it, nothing else moves.
  return bPre && !aPre;
}

/**
 * The directory npm would replace, or null when we are not an npm install at all — a source
 * checkout under `tsx`, where an update is `git pull` and none of our business.
 */
export function packageRoot(): string | null {
  const entry = process.argv[1] ? resolve(process.argv[1]) : '';
  const marker = `${sep}node_modules${sep}${PACKAGE_NAME}${sep}`;
  const at = entry.indexOf(marker);
  return at < 0 ? null : entry.slice(0, at + marker.length - 1);
}

function npmProcess(args: string[], opts: Parameters<typeof spawn>[2] = {}) {
  // A .cmd cannot be spawned without a shell since Node 20.12 (CVE-2024-27980); our arguments are
  // fixed strings with no spaces or quotes, so the shell adds no exposure here.
  return spawn(isWindows ? 'npm.cmd' : 'npm', args, { shell: isWindows, ...opts });
}

interface RunResult {
  ok: boolean;
  output: string;
}

/** Run npm and collect its output. Never rejects: a failure is a result, not an exception. */
function runNpm(args: string[], timeoutMs = NPM_TIMEOUT_MS): Promise<RunResult> {
  return new Promise((res) => {
    let output = '';
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      res({ ok, output: output.trim() });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = npmProcess(args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      res({ ok: false, output: String(err) });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      output += '\ntimed out';
      finish(false);
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on('data', (c) => {
      output += c;
    });
    child.stderr?.on('data', (c) => {
      output += c;
    });
    child.on('error', (err) => {
      output += String(err);
      finish(false);
    });
    child.on('exit', (code) => finish(code === 0));
  });
}

async function isWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether this copy is ours to replace, decided without asking npm anything.
 *
 * Two ways it is not. It may be a *local* dependency of some project — `npm install -g`
 * would then update a different copy and the one running would stay behind — and a project
 * has a package.json above its `node_modules`, which is what that test is. Or the directory
 * may not be ours to write: a Node from nodejs.org puts globals under /usr/local, owned by
 * root, where the honest answer is a command for the user rather than a spinner that fails.
 *
 * `npm root -g` would have answered the first question directly, and did until this: npm
 * treats `prefix` as a protected option and prints it as `***` whenever it came from the
 * environment (`npm_config_prefix`, which is how people usually escape a root-owned global
 * directory), so the comparison failed for exactly the users who need this most. What proves
 * it in the end is the version check after the install — if the copy we are running did not
 * change, the install went somewhere else and `applyUpdate` says so.
 */
async function installability(root: string): Promise<{ ok: boolean; command: string }> {
  const command = `${isWindows ? '' : 'sudo '}npm install -g ${PACKAGE_NAME}`;
  const project = join(root, '..', '..', 'package.json');
  try {
    await access(project, constants.F_OK);
    return { ok: false, command: `npm install -g ${PACKAGE_NAME}` }; // a local dependency
  } catch {}
  // npm removes and recreates the package directory, so the parent has to be writable too.
  const ok = (await isWritable(root)) && (await isWritable(join(root, '..')));
  return { ok, command };
}

/** The registry's own answer, cached in settings for a day so a launch costs nothing. */
async function latestVersion(): Promise<string | null> {
  const settings = loadSettings();
  const age = Date.now() - settings.lastUpdateCheck;
  if (age >= 0 && age < CHECK_INTERVAL_MS && settings.latestSeen) return settings.latestSeen;
  try {
    const res = await fetch(REGISTRY_URL, {
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return settings.latestSeen;
    const body = (await res.json()) as { version?: unknown };
    const version = typeof body.version === 'string' ? body.version : null;
    saveSettings({ lastUpdateCheck: Date.now(), latestSeen: version });
    return version;
  } catch {
    // Offline, slow, or the registry is having a day. Whatever we knew last still stands.
    return settings.latestSeen;
  }
}

let pending: string | null = null;
let restartRequested = false;

/** What the exit path installs, set once the tarball is actually in the cache. */
export function pendingUpdate(): string | null {
  return pending;
}

/**
 * `r` was pressed. The install cannot start here — Ink is still on screen and the engine
 * still holds the native modules — so the key only leaves this note and unmounts; the CLI
 * entry reads it once everything has stopped.
 */
export function requestRestartForUpdate(): void {
  restartRequested = true;
}

export function restartWasRequested(): boolean {
  return restartRequested;
}

/**
 * The whole background check, from the TUI's first render. Resolves to what the home screen
 * should say, or null for the common case of nothing to say.
 */
export async function checkForUpdate(policy: UpdatePolicy): Promise<UpdateStatus | null> {
  if (policy === 'off') return null;
  const root = packageRoot();
  if (!root) return null; // a source checkout: not ours to update
  const version = await latestVersion();
  if (!version || !isNewerVersion(version, APP_VERSION)) return null;

  const { ok, command } = await installability(root);
  if (!ok) return { version, ready: false, command };
  if (policy === 'notify') return { version, ready: false, command: `npm install -g ${PACKAGE_NAME}` };

  // Fetch it now, while a failure costs nothing and nobody is waiting. `npm cache add` does
  // not touch the installed tree, so this is safe next to a running engine.
  const fetched = await runNpm(['cache', 'add', `${PACKAGE_NAME}@${version}`]);
  if (!fetched.ok) return null;
  pending = version;
  return { version, ready: true };
}

function log(line: string): void {
  try {
    appendFileSync(UPDATE_LOG, `[${new Date().toISOString()}] ${line}\n`);
  } catch {}
}

/**
 * Install a version and prove it runs. `onOutput` is where npm's own noise goes: the
 * terminal when someone pressed `r` and is watching, the log file when they have gone.
 *
 * The proof matters more than it looks. `audify` ships no binary in its tarball — an install
 * script downloads one — so a half-finished install leaves a package that cannot open a
 * microphone, and the app would come back mute rather than not come back. When that happens
 * we put the version that was working back: this process is the *old* bundle (it was loaded
 * before npm touched the disk), so `APP_VERSION` here is exactly what to return to.
 */
export async function applyUpdate(version: string, onOutput: (line: string) => void): Promise<boolean> {
  const root = packageRoot();
  if (!root) return false;
  onOutput(`Installing ${PACKAGE_NAME}@${version}...`);
  const install = await runNpm(['install', '-g', `${PACKAGE_NAME}@${version}`]);
  if (install.output) onOutput(install.output);
  if (!install.ok) {
    onOutput(`Update failed; staying on v${APP_VERSION}.`);
    return false;
  }
  const now = installedVersion(root);
  if (now !== version) {
    // npm reported success but our own package.json still says something else: it replaced a
    // different copy (a global one while we run from a project's node_modules, most likely).
    onOutput(`v${version} was installed elsewhere; this copy is still v${now ?? 'unknown'}.`);
    return false;
  }
  if (await nativesLoad(root)) {
    onOutput(`Updated to v${version}.`);
    return true;
  }
  // `audify` ships no binary in its tarball — an install script downloads one — and npm
  // skips install scripts unless they are allowed by name. `install.ps1` repairs it the same
  // way, and it is worth one more try before giving the version back.
  onOutput('The audio module did not build; retrying with its install script allowed...');
  const repair = await runNpm(['install', '-g', '--allow-scripts=audify', `${PACKAGE_NAME}@${version}`]);
  if (repair.output) onOutput(repair.output);
  if (repair.ok && (await nativesLoad(root))) {
    onOutput(`Updated to v${version}.`);
    return true;
  }
  onOutput(`v${version} cannot load its audio modules; rolling back to v${APP_VERSION}...`);
  const back = await runNpm(['install', '-g', `${PACKAGE_NAME}@${APP_VERSION}`]);
  onOutput(back.ok ? `Rolled back to v${APP_VERSION}.` : `Rollback failed. Run: npm install -g ${PACKAGE_NAME}`);
  return false;
}

/** What the package on disk says it is now, which is how we know npm replaced *this* copy. */
function installedVersion(root: string): string | null {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

/** The check `install.ps1` already does, for the same reason: a package without its `.node`. */
function nativesLoad(root: string): Promise<boolean> {
  return new Promise((res) => {
    const child = spawn(process.execPath, ['-e', "require('audify'); require('@roamhq/wrtc')"], {
      cwd: root,
      stdio: 'ignore',
    });
    child.on('error', () => res(false));
    child.on('exit', (code) => res(code === 0));
  });
}

/**
 * Install after the app is gone: a detached process running the bundle we came from, its
 * output to the log. Started only once Ink has unmounted and the engine has exited, so
 * nothing of ours holds a native module while npm replaces the directory.
 */
export function installOnExit(version: string): void {
  try {
    log(`Installing v${version} in the background (from v${APP_VERSION}).`);
    const child = spawn(process.execPath, [process.argv[1], '--apply-update', version], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch (err) {
    log(`Could not start the background install: ${err}`);
  }
}

/** The `--apply-update` mode: the detached installer above, writing to the log. */
export async function runUpdateInstaller(version: string): Promise<number> {
  const ok = await applyUpdate(version, log);
  return ok ? 0 : 1;
}

/**
 * `r` on the home screen: install with npm's output in plain view — we are out of the
 * alternate screen by now and the native modules take a good few seconds — then start the
 * new bundle with the arguments this one was given and hand the terminal over to it.
 */
export async function updateAndRelaunch(version: string): Promise<never> {
  const write = (line: string) => process.stdout.write(`${line}\n`);
  const ok = await applyUpdate(version, write);
  log(ok ? `Updated to v${version} on request.` : `Requested update to v${version} failed.`);
  const child = spawn(process.execPath, [process.argv[1], ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', () => process.exit(1));
  return new Promise<never>(() => {});
}
