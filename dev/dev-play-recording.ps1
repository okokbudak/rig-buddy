# Dev helper: plays a synthetic telemetry recording (from dev-run-sim.ps1)
# through the telemetry client, instead of the game. The app's own telemetry
# client is paused meanwhile; resume it from the tray menu (click the
# telemetry client line) or with: bin\RigBuddy.exe --start telemetry
param([string]$File)
$root = Split-Path $PSScriptRoot -Parent
if (-not $File) { $File = Join-Path $root 'data\sim\berlin-hamburg.ndjson.gz' }
$node = Join-Path $root 'vendor\node\node.exe'
. "$PSScriptRoot\nav-control.ps1"
Send-Nav 'stop telemetry' | Out-Null
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'index\.ts recorded' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$env:Path = "$(Split-Path $node);$env:Path"; $env:NODE_ENV = 'development'
$logs = Join-Path $root 'logs'; New-Item -ItemType Directory -Force $logs | Out-Null
Set-Location (Join-Path $root 'vendor\tm-maps\packages\clis\navigator')
Start-Process -FilePath $node -ArgumentList "..\..\..\node_modules\tsx\dist\cli.mjs index.ts recorded `"$File`"" `
  -RedirectStandardOutput "$logs\recording.log" -RedirectStandardError "$logs\recording.err" -WindowStyle Hidden
Start-Sleep -Seconds 6
Get-Content "$logs\recording.log" -Tail 5
