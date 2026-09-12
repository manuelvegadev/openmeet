# OpenMeet for Windows, one binary: the latest release into %LOCALAPPDATA%\openmeet, on the
# PATH. ffmpeg (for screen sharing) through winget when it is missing. Nothing is registered
# with the system — see the note at the end.
#   irm https://raw.githubusercontent.com/manuelvegadev/openmeet/main/packages/go/scripts/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$repo = 'manuelvegadev/openmeet'
$dir = Join-Path $env:LOCALAPPDATA 'openmeet'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$base = "https://github.com/$repo/releases/latest/download"
Write-Host "downloading openmeet..."
Invoke-WebRequest -Uri "$base/openmeet-windows-amd64.exe" -OutFile (Join-Path $dir 'openmeet.new.exe')
Move-Item -Force (Join-Path $dir 'openmeet.new.exe') (Join-Path $dir 'openmeet.exe')
foreach ($f in 'wt-profile.ps1', 'create-shortcut.ps1', 'openmeet.ico', 'openmeet.png') {
  try { Invoke-WebRequest -Uri "$base/$f" -OutFile (Join-Path $dir $f) } catch { }
}
# On the user's PATH, for this session and for good.
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not ($userPath -split ';' | Where-Object { $_ -eq $dir })) {
  [Environment]::SetEnvironmentVariable('Path', "$userPath;$dir", 'User')
}
$env:Path = "$env:Path;$dir"
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Host "ffmpeg not found: installing Gyan.FFmpeg with winget (screen sharing needs it)"
  try { winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements | Out-Null } catch { Write-Host "  winget failed; install ffmpeg by hand for screen sharing" }
}
# Deliberately nothing else: no Start Menu entry, no desktop shortcut, no terminal profile
# written behind your back. This is a terminal application, and which terminal is the user's
# to choose — a shortcut would pick one for them. The two scripts are there for anyone who
# wants Windows Terminal set up that way, and they are theirs to run.
Write-Host "installed $(& (Join-Path $dir 'openmeet.exe') --version) at $dir — run: openmeet"
Write-Host "optional, for a Windows Terminal profile and a desktop shortcut:"
Write-Host "  & '$dir\wt-profile.ps1' -Command '$dir\openmeet.exe' -Icon '$dir\openmeet.png'"
Write-Host "  & '$dir\create-shortcut.ps1' -Icon '$dir\openmeet.ico'"
