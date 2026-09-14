# Lets the head unit reach this PC: allows inbound connections to the bundled
# Node.js (navigation server :62840, agent :62843) on PRIVATE networks only,
# and removes "block" rules Windows created if its firewall prompt was dismissed.
# Asks for administrator rights (UAC).
#
#   powershell -ExecutionPolicy Bypass -File setup\allow-firewall.ps1
$ErrorActionPreference = 'Stop'
$node = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\vendor\node\node.exe'))
if (-not (Test-Path $node)) { throw "$node not found: run setup\setup-pc.ps1 first" }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  exit
}

$rules = Get-NetFirewallApplicationFilter | Where-Object { $_.Program -eq $node } | Get-NetFirewallRule
$rules | Where-Object { $_.Action -eq 'Block' } | ForEach-Object {
  Write-Host "removing block rule: $($_.DisplayName) ($($_.Profile))"
  Remove-NetFirewallRule -Name $_.Name
}
Get-NetFirewallRule -DisplayName 'Rig Buddy (Node.js)', 'ETS2 Nav (Node.js)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'Rig Buddy (Node.js)' -Direction Inbound -Action Allow -Profile Private `
  -Program $node -Protocol TCP -LocalPort 62840, 62843 | Out-Null
Write-Host "allowed: $node (TCP 62840, 62843, private networks)" -ForegroundColor Green
Write-Host 'Your Wi-Fi must be set to "Private" in Windows network settings.'
Start-Sleep -Seconds 3
