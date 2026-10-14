# Flashes out\firmware.bin (from build.sh) to the Octopus over USB, no BOOT0 jumper needed.
# ASK FIRST: this changes what runs on the board. Never use a binary that build.sh did not verify.
# The running firmware gets "BOOTLOADER", the chip enters the ST ROM DFU, the .bin goes to 0x08008000
# (the BTT bootloader at 0x08000000 is never touched), then the board starts the new firmware.
# Usage:  powershell -ExecutionPolicy Bypass -File flash.ps1 [-Bin other.bin] [-DfuUtil C:\path\dfu-util.exe]
param(
  [string]$Bin = "$PSScriptRoot\out\firmware.bin",   # build.sh puts it there
  [string]$DfuUtil = $env:DFU_UTIL                    # path to dfu-util.exe (0.11 or newer); else the one on PATH
)
$ErrorActionPreference = 'Continue'   # dfu-util writes harmless warnings to stderr
$dfu = if ($DfuUtil) { $DfuUtil } else { (Get-Command dfu-util -ErrorAction SilentlyContinue).Source }
if (-not $dfu -or -not (Test-Path $dfu)) { throw 'dfu-util not found: pass -DfuUtil <path to dfu-util.exe> or set DFU_UTIL' }
if (-not (Test-Path $Bin)) { throw "firmware not found: $Bin (build it with build.sh)" }

function Test-Dfu { (& $dfu -l 2>&1 | Out-String) -match '0483:df11' }

if (-not (Test-Dfu)) {
  $dev = Get-PnpDevice -PresentOnly -Class Ports | Where-Object { $_.InstanceId -match 'VID_0483&PID_5740' } | Select-Object -First 1
  if (-not $dev -or $dev.FriendlyName -notmatch '(COM\d+)') { throw 'Octopus not found (neither COM port nor DFU)' }
  $com = $Matches[1]
  Write-Host "Octopus on $com, sending BOOTLOADER"
  $p = New-Object System.IO.Ports.SerialPort $com, 115200
  $p.DtrEnable = $true
  $p.Open(); $p.Write("BOOTLOADER`n"); Start-Sleep -Milliseconds 100
  try { $p.Close() } catch {}
  $t = 0
  while (-not (Test-Dfu)) { Start-Sleep -Milliseconds 500; if (++$t -gt 20) { throw 'DFU device did not appear' } }
}

Write-Host "Writing $Bin to 0x08008000"
& $dfu -d 0483:df11 -a 0 -s 0x08008000 -D $Bin 2>&1 | Select-String 'successfully' | Out-Host
$chk = Join-Path $env:TEMP 'octopus_verify.bin'
Remove-Item $chk -ErrorAction SilentlyContinue
& $dfu -d 0483:df11 -a 0 -s "0x08008000:$((Get-Item $Bin).Length)" -U $chk 2>&1 | Out-Null
if ((Get-FileHash $Bin -Algorithm MD5).Hash -ne (Get-FileHash $chk -Algorithm MD5).Hash) { throw 'VERIFY FAILED, run flash.ps1 again' }
Write-Host 'Verify OK, starting the firmware'
& $dfu -d 0483:df11 -a 0 -s 0x08008000:leave -D $Bin 2>&1 | Out-Null
Write-Host 'Done'
