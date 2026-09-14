# Builds the APK and installs Rig Buddy on the head unit over ADB, pushes the
# map tiles, and points the app at this PC. (Phones and tablets: install the
# APK any way you like; the app downloads the map from Rig Buddy.)
#
#   setup\install-headunit.ps1 -Device 192.168.1.50:5555 -PcHost 192.168.1.10
#
# -Device   head unit's ADB address (Wi-Fi ADB ip:port), or a USB serial
# -PcHost   this PC's LAN IP (the app connects to it); asked in the app if omitted
# -NoBuild  install the last built APK
param(
  [Parameter(Mandatory = $true)][string]$Device,
  [string]$PcHost,
  [switch]$NoBuild
)
. "$PSScriptRoot\lib.ps1"
$apk = Join-Path $Root 'android\app\build\outputs\apk\debug\app-debug.apk'
$pkg = 'tr.ets2nav'

if (-not $NoBuild) {
  Step 'build APK'
  if (-not (Test-Path "$Root\android\app\src\main\assets\glyphs")) {
    throw 'android assets\glyphs missing: run setup\setup-pc.ps1 first'
  }
  $env:JAVA_HOME = Get-JavaHome
  Push-Location "$Root\android"
  try { Exec { & "$Root\vendor\gradle\bin\gradle.bat" assembleDebug -q --console=plain } 'gradle assembleDebug' }
  finally { Pop-Location }
  Write-Host "  $apk"
}

$adb = Get-Adb
if ($Device -match ':') { & $adb connect $Device | Out-Host }
function Adb { & $adb -s $Device @args; if ($LASTEXITCODE -ne 0) { throw "adb $args failed" } }

Step 'install'
Adb install -r $apk

Step 'map tiles'
$tiles = Join-Path $Root 'data\ets2.mbtiles'
$remoteDir = "/sdcard/Android/data/$pkg/files"
if (Test-Path $tiles) {
  Adb shell mkdir -p $remoteDir
  Adb push $tiles "$remoteDir/ets2.mbtiles"
} else {
  Write-Warning 'data\ets2.mbtiles missing (start Rig Buddy once to build it); the app downloads the map from Rig Buddy instead.'
}

Step 'start'
if ($PcHost) { Adb shell am start -n "$pkg/.MainActivity" --es host $PcHost | Out-Null }
else { Adb shell am start -n "$pkg/.MainActivity" | Out-Null }
Write-Host "`nInstalled. Start Rig Buddy on this PC (Start menu, runs in the tray); the app connects by itself." -ForegroundColor Green
