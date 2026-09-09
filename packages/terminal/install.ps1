# OpenMeet Terminal installer for Windows
# Usage (PowerShell):
#   irm https://raw.githubusercontent.com/manuelvegadev/openmeet/main/packages/terminal/install.ps1 | iex

$ErrorActionPreference = 'Stop'

function Info($msg) { Write-Host "[+] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "[x] $msg" -ForegroundColor Red; exit 1 }

# Installers append to the machine/user PATH; pick that up without opening a new shell.
function Sync-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

# --- Node.js >= 22 ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) { Fail "Node.js >= 22 is required. Install it from https://nodejs.org and re-run this script." }
  Info "Node.js not found, installing the LTS release with winget..."
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  Sync-Path
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { Fail "Node.js was installed but is not on PATH yet. Open a new terminal and re-run this script." }
}

$major = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
if ($major -lt 22) { Fail "Node.js >= 22 required (found $(& node -v)). Update from https://nodejs.org" }

# --- Install ---
Info "Installing openmeet-terminal..."
& npm install -g openmeet-terminal
if ($LASTEXITCODE -ne 0) { Fail "npm install failed" }

# The npm global bin directory may have just been created; pick it up in this session.
Sync-Path

# --- Native modules ---
# audify ships no prebuilt binary in its npm tarball: it downloads one from an install
# script. Some npm versions skip package install scripts by default, which would leave the
# app without audio, so check and repair once.
$pkgRoot = Join-Path (& npm root -g) 'openmeet-terminal'
Push-Location $pkgRoot
& node -e "require('audify'); require('@roamhq/wrtc')" 2>$null
$nativeOk = $LASTEXITCODE -eq 0
Pop-Location
if (-not $nativeOk) {
  Warn "The native audio module did not build; retrying with install scripts enabled..."
  & npm install -g --allow-scripts=audify openmeet-terminal
  Push-Location $pkgRoot
  & node -e "require('audify'); require('@roamhq/wrtc')" 2>$null
  $nativeOk = $LASTEXITCODE -eq 0
  Pop-Location
  if (-not $nativeOk) { Fail "The native audio module could not be installed. Run: npm install -g --allow-scripts=audify openmeet-terminal" }
}

# --- ffmpeg (screen sharing); optional ---
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Info "ffmpeg not found, installing it with winget (needed for screen sharing)..."
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { Warn "ffmpeg install failed; screen sharing will be disabled until it is installed." }
    Sync-Path
  } else {
    Warn "ffmpeg not found; install it (winget install Gyan.FFmpeg) to enable screen sharing."
  }
}

# --- Windows Terminal profile + desktop shortcut (own window, app icon) ---
$wt = Get-Command wt.exe -ErrorAction SilentlyContinue
if ($wt) {
  try {
    $pkg = Join-Path (& npm root -g) 'openmeet-terminal\windows'
    $dest = Join-Path $env:LOCALAPPDATA 'openmeet'
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item (Join-Path $pkg 'openmeet-icon.png'), (Join-Path $pkg 'openmeet.ico') -Destination $dest -Force
    # A native command that fails does not throw, so check it: a missing profile would
    # leave the desktop shortcut pointing at nothing.
    & node (Join-Path $pkg 'wt-profile.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'the Windows Terminal profile could not be written' }
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $pkg 'create-shortcut.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'the desktop shortcut could not be created' }
    Info "Windows Terminal profile and desktop shortcut created"
  } catch {
    Warn "Could not set up the Windows Terminal profile: $_"
  }
} else {
  Warn "Windows Terminal not found; install it from the Microsoft Store for the best experience."
}

Sync-Path

# --- Smoke test ---
if (-not (Get-Command openmeet -ErrorAction SilentlyContinue)) {
  Warn "openmeet is installed but not on PATH yet; open a new terminal."
} else {
  # Capture the output whole: piping into Select-Object -First stops the pipeline early,
  # which fails the native command and would report a working install as broken.
  $help = & openmeet --help 2>&1
  if ($LASTEXITCODE -ne 0) { Fail "openmeet was installed but does not run: $help" }
}

Info "Installed successfully!"
Write-Host ""
Write-Host "  Usage:" -ForegroundColor White
Write-Host "    openmeet --room <room-id>"
Write-Host ""
Write-Host "  Audio uses WASAPI directly (no sox needed). Screen sharing needs ffmpeg; webcam is not available on Windows yet."
Write-Host "  Use Windows Terminal for the best experience."
Write-Host ""
