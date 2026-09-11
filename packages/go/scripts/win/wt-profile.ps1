# An "OpenMeet" profile in Windows Terminal, so the app opens in its own window: the app's
# icon and name in the title row, tab row and padding in the app's black, no scrollbar,
# closes when the app exits. The port of packages/terminal/windows/wt-profile.cjs, with no
# Node on the machine. Idempotent; keeps a backup of settings.json next to it.
#   powershell -ExecutionPolicy Bypass -File wt-profile.ps1 [-Command <what to run>] [-Icon <png>]
param(
  [string]$Command = (Join-Path $env:LOCALAPPDATA 'openmeet\openmeet.exe'),
  [string]$Icon = (Join-Path $env:LOCALAPPDATA 'openmeet\openmeet.png')
)
$candidates = @(
  (Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows Terminal\settings.json')
)
$file = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $file) {
  $seed = $candidates | Where-Object { Test-Path (Split-Path $_) } | Select-Object -First 1
  if (-not $seed) { Write-Error 'Windows Terminal settings.json not found; is Windows Terminal installed?'; exit 1 }
  Set-Content -Path $seed -Value '{"$schema":"https://aka.ms/terminal-profiles-schema","profiles":{"list":[]}}' -Encoding UTF8
  $file = $seed
}
$raw = Get-Content -Raw -Path $file
Set-Content -Path "$file.openmeet-backup" -Value $raw -Encoding UTF8
$clean = ($raw -replace '^﻿', '') -replace '(?m)^\s*//.*$', ''
$cfg = $clean | ConvertFrom-Json
$BG = '#0B0B0B'
$profile = [ordered]@{
  name = 'OpenMeet'; guid = '{7f1e3d2a-6c5b-4a9e-9d10-0c0ffee0a1b2}'
  commandline = "cmd /c `"$Command`""; icon = $Icon; tabTitle = 'OpenMeet'
  suppressApplicationTitle = $true; closeOnExit = 'always'; scrollbarState = 'hidden'; padding = '4'
  font = @{ face = 'Cascadia Mono'; size = 11 }; colorScheme = 'One Half Dark'; background = $BG
  useAcrylic = $false; hidden = $false
}
if (-not $cfg.profiles) { $cfg | Add-Member -NotePropertyName profiles -NotePropertyValue ([pscustomobject]@{ list = @() }) }
if (-not $cfg.profiles.list) { $cfg.profiles | Add-Member -NotePropertyName list -NotePropertyValue @() -Force }
$list = @($cfg.profiles.list | Where-Object { $_.guid -ne $profile.guid -and $_.name -ne 'OpenMeet' })
$list += [pscustomobject]$profile
$cfg.profiles.list = $list
$cfg | Add-Member -NotePropertyName showTabsInTitlebar -NotePropertyValue $true -Force
$cfg | Add-Member -NotePropertyName alwaysShowTabs -NotePropertyValue $true -Force
$themes = @()
if ($cfg.themes) { $themes = @($cfg.themes | Where-Object { $_.name -ne 'OpenMeet' }) }
$themes += [pscustomobject]@{
  name = 'OpenMeet'
  window = @{ applicationTheme = 'dark'; useMica = $false }
  tabRow = @{ background = $BG; unfocusedBackground = $BG }
  tab = @{ background = $BG; unfocusedBackground = $BG; showCloseButton = 'never'; iconStyle = 'default' }
}
$cfg | Add-Member -NotePropertyName themes -NotePropertyValue $themes -Force
$cfg | Add-Member -NotePropertyName theme -NotePropertyValue 'OpenMeet' -Force
$cfg | ConvertTo-Json -Depth 20 | Set-Content -Path $file -Encoding UTF8
Write-Host "OpenMeet profile written to $file"
