# OpenMeet Terminal installer for Windows
# Usage (PowerShell):
#   irm https://raw.githubusercontent.com/manuvega/openmeet/main/packages/terminal/install.ps1 | iex

$ErrorActionPreference = 'Stop'

function Info($msg) { Write-Host "[+] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "[x] $msg" -ForegroundColor Red; exit 1 }

# --- Node.js >= 22 ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) { Fail "Node.js >= 22 is required. Install it from https://nodejs.org and re-run this script." }
  Info "Node.js not found, installing the LTS release with winget..."
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  # Pick up the PATH written by the installer without opening a new shell
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { Fail "Node.js was installed but is not on PATH yet. Open a new terminal and re-run this script." }
}

$major = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
if ($major -lt 22) { Fail "Node.js >= 22 required (found $(& node -v)). Update from https://nodejs.org" }

# --- Install ---
Info "Installing openmeet-terminal..."
& npm install -g openmeet-terminal
if ($LASTEXITCODE -ne 0) { Fail "npm install failed" }

# --- ffmpeg (screen sharing); optional ---
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Info "ffmpeg not found, installing it with winget (needed for screen sharing)..."
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { Warn "ffmpeg install failed; screen sharing will be disabled until it is installed." }
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
    & node (Join-Path $pkg 'wt-profile.cjs')
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $pkg 'create-shortcut.ps1')
    Info "Windows Terminal profile and desktop shortcut created"
  } catch {
    Warn "Could not set up the Windows Terminal profile: $_"
  }
} else {
  Warn "Windows Terminal not found; install it from the Microsoft Store for the best experience."
}

Info "Installed successfully!"
Write-Host ""
Write-Host "  Usage:" -ForegroundColor White
Write-Host "    openmeet --room <room-id>"
Write-Host ""
Write-Host "  Audio uses WASAPI directly (no sox needed). Screen sharing needs ffmpeg; webcam is not available on Windows yet."
Write-Host "  Use Windows Terminal for the best experience."
Write-Host ""
