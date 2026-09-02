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

Info "Installed successfully!"
Write-Host ""
Write-Host "  Usage:" -ForegroundColor White
Write-Host "    openmeet --room <room-id>"
Write-Host ""
Write-Host "  Audio uses WASAPI directly (no sox needed). Video is not available on Windows yet."
Write-Host "  Use Windows Terminal for the best experience."
Write-Host ""
