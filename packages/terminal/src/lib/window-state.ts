/**
 * Knows whether anyone can see the TUI, so rendering can pause and save CPU.
 *
 * A terminal app owns no window: the emulator does. So "minimized" is asked from the OS
 * about the *hosting* window, through a small long-lived helper process that polls once a
 * second and prints state changes:
 *
 * - Windows: PowerShell + Win32. Under Windows Terminal the console window is hidden, so the
 *   helper walks the parent chain to WindowsTerminal.exe and picks its top-level window whose
 *   title matches ours (the profile pins it to "OpenMeet"); under plain conhost it is
 *   GetConsoleWindow itself. Then IsIconic.
 * - macOS: osascript against Terminal.app or iTerm2 (from TERM_PROGRAM), reading
 *   `miniaturized` of the window whose name contains our title. The first run triggers the
 *   Automation permission prompt once; if denied, the watcher stops and rendering is never
 *   paused. Other emulators (WezTerm, kitty, Ghostty…) have no scripting for this: no pause.
 *
 * `unfocused` instead uses terminal focus reporting (ESC[?1004h → ESC[I / ESC[O), which most
 * emulators support (not Terminal.app). Ink 7 does not understand those sequences and would
 * read them as Escape, so stdin is proxied through a filter that strips them first.
 */
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { platform } from 'node:os';
import { PassThrough } from 'node:stream';

export const RENDER_PAUSE_POLICIES = ['never', 'minimized', 'unfocused'] as const;
export type RenderPausePolicy = (typeof RENDER_PAUSE_POLICIES)[number];

export function parsePausePolicyFlag(value: string): RenderPausePolicy | null {
  return (RENDER_PAUSE_POLICIES as readonly string[]).includes(value) ? (value as RenderPausePolicy) : null;
}

/** Title we give the terminal window/tab so the OS-side helpers can find it. */
export const WINDOW_TITLE = 'OpenMeet';

/** Emits `change` (hidden: boolean). Hidden = minimized (or unfocused, per policy). */
class Visibility extends EventEmitter {
  hidden = false;
  set(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    this.emit('change', hidden);
  }
}

export const visibility = new Visibility();

// ─── Minimized: OS helpers ────────────────────────────────────────────

const WINDOWS_WATCHER = `
$title = $args[0]
$parentPid = [int]$args[1]
Add-Type -Namespace W -Name U -MemberDefinition @"
[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
"@
function Find-HostWindow {
  $con = [W.U]::GetConsoleWindow()
  if ($con -ne [IntPtr]::Zero -and [W.U]::IsWindowVisible($con)) { return $con }
  # Walk up to the terminal emulator that owns the pseudo-console.
  $pid0 = $PID
  for ($i = 0; $i -lt 8; $i++) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $pid0" -ErrorAction SilentlyContinue
    if (-not $p) { break }
    if ($p.Name -ieq 'WindowsTerminal.exe') {
      $found = [IntPtr]::Zero; $any = [IntPtr]::Zero
      $cb = [W.U+EnumProc]{ param($h, $l)
        $wp = 0; [void][W.U]::GetWindowThreadProcessId($h, [ref]$wp)
        if ($wp -eq $script:wtPid -and [W.U]::IsWindowVisible($h)) {
          $sb = New-Object System.Text.StringBuilder 256; [void][W.U]::GetWindowText($h, $sb, 256)
          if ($sb.ToString() -eq $script:wtTitle) { $script:found = $h }
          if ($script:any -eq [IntPtr]::Zero) { $script:any = $h }
        }
        return $true }
      $script:wtPid = $p.ProcessId; $script:wtTitle = $title; $script:found = $found; $script:any = $any
      [void][W.U]::EnumWindows($cb, [IntPtr]::Zero)
      if ($script:found -ne [IntPtr]::Zero) { return $script:found }
      return $script:any
    }
    $pid0 = $p.ParentProcessId
  }
  return [IntPtr]::Zero
}
$h = Find-HostWindow
if ($h -eq [IntPtr]::Zero) { Write-Output 'unsupported'; exit 0 }
$last = $null
while ($true) {
  # The TUI died without cleaning up (kill -9, crash): don't outlive it.
  if (-not (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)) { exit 0 }
  $min = [W.U]::IsIconic($h)
  if ($min -ne $last) { Write-Output ($(if ($min) { 'hidden' } else { 'visible' })); $last = $min }
  Start-Sleep -Milliseconds 1000
}
`;

function macWatcherScript(app: 'Terminal' | 'iTerm2', title: string, parentPid: number): string {
  // `log` goes to stderr, which is what we read. `miniaturized` is a standard window property.
  // The parent check stops the loop if the TUI died without cleaning up.
  return `
set lastState to ""
repeat
  try
    do shell script "kill -0 ${parentPid}"
  on error
    return
  end try
  set state to "visible"
  try
    tell application "${app}"
      set wins to (every window whose name contains "${title}")
      if (count of wins) > 0 then
        if miniaturized of item 1 of wins then set state to "hidden"
      end if
    end tell
  on error
    log "unsupported"
    return
  end try
  if state is not lastState then
    log state
    set lastState to state
  end if
  delay 1
end repeat`;
}

/**
 * Start the OS-side minimized watcher. Returns a stop function. Emits through `visibility`.
 * Silently does nothing on platforms/terminals without support.
 */
export function startMinimizedWatcher(onDebug?: (msg: string) => void): () => void {
  let child: ReturnType<typeof spawn> | null = null;
  const os = platform();
  if (os === 'win32') {
    child = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_WATCHER, WINDOW_TITLE, String(process.pid)],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      },
    );
  } else if (os === 'darwin') {
    const prog = process.env.TERM_PROGRAM;
    const app = prog === 'Apple_Terminal' ? 'Terminal' : prog === 'iTerm.app' ? 'iTerm2' : null;
    if (!app) {
      onDebug?.(`Window watcher: no minimized detection for ${prog ?? 'this terminal'}`);
      return () => {};
    }
    child = spawn('osascript', ['-e', macWatcherScript(app, WINDOW_TITLE, process.pid)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } else {
    return () => {};
  }

  const stream = os === 'win32' ? child.stdout : child.stderr;
  let buf = '';
  stream?.on('data', (chunk: Buffer) => {
    buf += chunk.toString();
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line === 'hidden' || line === 'visible') {
        visibility.set(line === 'hidden');
        onDebug?.(`Window ${line}${line === 'hidden' ? ': rendering paused' : ': rendering resumed'}`);
      } else if (line === 'unsupported') {
        onDebug?.('Window watcher: host window not found or automation denied; minimized detection off');
      }
      nl = buf.indexOf('\n');
    }
  });
  child.on('error', (err) => onDebug?.(`Window watcher failed: ${err.message}`));
  child.on('exit', () => visibility.set(false));
  child.unref();
  return () => {
    child?.kill();
    child = null;
  };
}

// ─── Unfocused: terminal focus reporting ──────────────────────────────

const FOCUS_ON = '\x1b[?1004h';
const FOCUS_OFF = '\x1b[?1004l';
const FOCUS_IN = '\x1b[I';
const FOCUS_OUT = '\x1b[O';

/**
 * A stdin stand-in for Ink that strips focus-report sequences (feeding `visibility`) and
 * forwards everything else. Mirrors the TTY surface Ink touches: isTTY, setRawMode, ref/unref.
 */
export function createFocusFilteredStdin(stdin: NodeJS.ReadStream): NodeJS.ReadStream {
  const out = new PassThrough();
  let carry = '';
  stdin.on('data', (chunk: Buffer | string) => {
    let s = carry + chunk.toString('utf8');
    carry = '';
    // A sequence split across chunks: hold back a trailing "ESC" or "ESC[".
    if (s.endsWith('\x1b') || s.endsWith('\x1b[')) {
      const cut = s.lastIndexOf('\x1b');
      carry = s.slice(cut);
      s = s.slice(0, cut);
    }
    if (s.includes(FOCUS_IN) || s.includes(FOCUS_OUT)) {
      // Last event wins within one chunk.
      const lastIn = s.lastIndexOf(FOCUS_IN);
      const lastOut = s.lastIndexOf(FOCUS_OUT);
      visibility.set(lastOut > lastIn);
      s = s.split(FOCUS_IN).join('').split(FOCUS_OUT).join('');
    }
    if (s) out.write(s);
  });
  stdin.on('end', () => out.end());
  const proxy = out as unknown as NodeJS.ReadStream & { setRawMode: (mode: boolean) => NodeJS.ReadStream };
  Object.defineProperty(proxy, 'isTTY', { value: stdin.isTTY });
  proxy.setRawMode = (mode: boolean) => {
    stdin.setRawMode?.(mode);
    return proxy;
  };
  proxy.ref = () => {
    stdin.ref();
    return proxy;
  };
  proxy.unref = () => {
    stdin.unref();
    return proxy;
  };
  process.stdout.write(FOCUS_ON);
  process.on('exit', () => process.stdout.write(FOCUS_OFF));
  return proxy;
}

/** Ask the emulator to title the window/tab so the OS-side watchers can find it. */
export function setTerminalTitle(title: string): void {
  process.stdout.write(`\x1b]0;${title}\x07`);
}
