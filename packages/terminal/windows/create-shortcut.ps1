# Creates a desktop shortcut that opens OpenMeet in its own Windows Terminal window.
#   powershell -ExecutionPolicy Bypass -File create-shortcut.ps1 [-Icon <path.ico>]
param([string]$Icon = (Join-Path $env:LOCALAPPDATA 'openmeet\openmeet.ico'))
$wt = Get-Command wt.exe -ErrorAction SilentlyContinue
if (-not $wt) { Write-Error 'Windows Terminal (wt.exe) not found'; exit 1 }
$desktop = [Environment]::GetFolderPath('Desktop')
$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'OpenMeet.lnk'))
$s.TargetPath = $wt.Source
$s.Arguments = '-w new --size 110,34 -p OpenMeet'
$s.Description = 'OpenMeet'
if (Test-Path $Icon) { $s.IconLocation = "$Icon,0" }
$s.Save()
Write-Host "Shortcut created: $($s.FullName)"
