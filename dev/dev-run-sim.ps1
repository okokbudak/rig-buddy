# Dev helper: builds a synthetic route recording. Needs the Rig Buddy app running
# (for the navigation server); its telemetry client is paused while the sim
# runs and resumed afterwards. usage: dev\dev-run-sim.ps1 <fromCity> <toCity> [kph]
param([string]$From = 'berlin', [string]$To = 'hamburg', [int]$Kph = 90)
$root = Split-Path $PSScriptRoot -Parent
. "$PSScriptRoot\nav-control.ps1"
$node = Join-Path $root 'vendor\node\node.exe'
$env:Path = "$(Split-Path $node);$env:Path"; $env:NODE_ENV = 'development'; $env:ETS2NAV_DATA = Join-Path $root 'data'
Send-Nav 'stop telemetry' | Out-Null
$logs = Join-Path $root 'logs'; New-Item -ItemType Directory -Force $logs | Out-Null
Set-Location (Join-Path $root 'vendor\tm-maps\packages\clis\navigator')
$p = Start-Process -FilePath $node -ArgumentList "..\..\..\node_modules\tsx\dist\cli.mjs ets2nav-sim.ts $From $To $Kph" `
  -RedirectStandardOutput "$logs\sim.log" -RedirectStandardError "$logs\sim.err" -PassThru -WindowStyle Hidden
$deadline = (Get-Date).AddSeconds(120)
while (-not $p.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
if (-not $p.HasExited) { 'sim timed out'; Stop-Process -Id $p.Id -Force }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'recorded' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Send-Nav 'start telemetry' | Out-Null
Get-Content "$logs\sim.log" | Where-Object { $_ -notmatch '^event (themeMode|trailer|routeProgress)' }
Get-Content "$logs\sim.err" | Select-Object -Last 12
