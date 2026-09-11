# A desktop shortcut for the Go client, in the same Windows Terminal window the Node one uses:
# the OpenMeet profile (theme, icon, size) with its command replaced by openmeet-go.cmd.
#   powershell -ExecutionPolicy Bypass -File create-shortcut-go.ps1
param([string]$Dir = (Split-Path -Parent $MyInvocation.MyCommand.Path))
$wt = Get-Command wt.exe -ErrorAction SilentlyContinue
if (-not $wt) { Write-Error 'Windows Terminal (wt.exe) not found'; exit 1 }
$cmd = Join-Path $Dir 'openmeet-go.cmd'
$desktop = [Environment]::GetFolderPath('Desktop')
$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'OpenMeet Go.lnk'))
$s.TargetPath = $wt.Source
$s.Arguments = "-w new --size 110,34 -p OpenMeet cmd /c `"$cmd`""
$s.WorkingDirectory = $Dir
$s.Description = 'OpenMeet (Go client)'
$icon = Join-Path $env:LOCALAPPDATA 'openmeet\openmeet.ico'
if (Test-Path $icon) { $s.IconLocation = "$icon,0" }
$s.Save()
Write-Host "Shortcut created: $($s.FullName)"
