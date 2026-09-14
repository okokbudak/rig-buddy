# Dev helper: (re)starts the navigation server inside the running ETS2 Nav app
# (starts the app if needed) and waits until the server answers.
. "$PSScriptRoot\nav-control.ps1"
$root = Split-Path $PSScriptRoot -Parent
if ($null -eq (Send-Nav 'restart server')) { Start-Process (Join-Path $root 'bin\ETS2Nav.exe') }
$deadline = (Get-Date).AddSeconds(150)
do {
  Start-Sleep -Seconds 2
  $status = Send-Nav 'status'
} until (($status -match 'server=running') -or ((Get-Date) -gt $deadline))
if ($status -match 'server=running') { 'server up' }
else { "server NOT up: $status"; Get-Content (Join-Path $root 'logs\server.log') -Tail 30 }
