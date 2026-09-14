# One-time setup of the gaming PC side of Rig Buddy. Safe to re-run: every step
# skips what is already there.
#
#   powershell -ExecutionPolicy Bypass -File setup\setup-pc.ps1
#
# Needs: git, .NET 8 SDK (dotnet), internet. Downloads into vendor\ (git-ignored):
#   vendor\node      portable Node.js 24
#   vendor\gradle    Gradle (Android build)
#   vendor\tm-maps   truckermudgeon/maps pinned + pc\patches\tm-maps applied
# and builds the PC app bin\RigBuddy.exe (+ Start menu shortcut), installs the
# SCS telemetry plugin into the games, downloads the map label fonts into the
# Android assets and opens the firewall for the head unit (asks for admin).
param(
  [switch]$SkipPlugin,  # don't copy scs-telemetry.dll into the game folders
  [switch]$SkipFirewall # don't run setup\allow-firewall.ps1
)
. "$PSScriptRoot\lib.ps1"
$vendor = Join-Path $Root 'vendor'
$tmp = Join-Path $vendor '_download'
New-Item -ItemType Directory -Force $vendor, $tmp | Out-Null

Step 'prerequisites'
foreach ($tool in 'git', 'dotnet') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "$tool not found. Install it first (winget install Git.Git / Microsoft.DotNet.SDK.8)."
  }
}

Step 'Node.js (vendor\node)'
$nodeDir = Join-Path $vendor 'node'
if (Test-Path "$nodeDir\node.exe") { Write-Host '  already there' } else {
  $base = 'https://nodejs.org/dist/latest-v24.x'
  $sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content
  if ($sums -is [byte[]]) { $sums = [Text.Encoding]::ASCII.GetString($sums) }
  $line = ($sums -split "`n") | Where-Object { $_ -match 'node-v[\d.]+-win-x64\.zip\s*$' } | Select-Object -First 1
  $hash, $file = $line.Trim() -split '\s+'
  $zip = Join-Path $tmp $file
  Get-File "$base/$file" $zip
  if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $hash) { throw "checksum mismatch: $file" }
  Expand-Archive $zip $tmp -Force
  Move-Item (Join-Path $tmp ($file -replace '\.zip$', '')) $nodeDir
}
$env:Path = "$nodeDir;$env:Path"
Write-Host "  node $(& "$nodeDir\node.exe" --version)"

Step "Gradle $GradleVersion (vendor\gradle)"
$gradleDir = Join-Path $vendor 'gradle'
if (Test-Path "$gradleDir\bin\gradle.bat") { Write-Host '  already there' } else {
  $file = "gradle-$GradleVersion-bin.zip"
  $zip = Join-Path $tmp $file
  Get-File "https://services.gradle.org/distributions/$file" $zip
  $sha = (Invoke-WebRequest -UseBasicParsing "https://services.gradle.org/distributions/$file.sha256").Content
  if ($sha -is [byte[]]) { $sha = [Text.Encoding]::ASCII.GetString($sha) }
  if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $sha.Trim()) { throw "checksum mismatch: $file" }
  Expand-Archive $zip $tmp -Force
  Move-Item (Join-Path $tmp "gradle-$GradleVersion") $gradleDir
}

Step "truckermudgeon/maps @ $TmMapsRev + patches (vendor\tm-maps)"
$tm = Join-Path $vendor 'tm-maps'
if (Test-Path "$tm\.git") { Write-Host '  already there' } else {
  Exec { git clone -q $TmMapsRepo $tm } 'git clone'
  Exec { git -C $tm checkout -q -b ets2nav-local $TmMapsRev } 'git checkout'
  $patches = (Get-ChildItem "$Root\pc\patches\tm-maps\*.patch" | Sort-Object Name).FullName
  Exec { git -C $tm -c user.name=ets2nav -c user.email=ets2nav@localhost am -q $patches } 'git am'
}
# (re)install when missing, or when the repo folder moved: npm's workspace
# links are absolute junctions that then point nowhere.
if (-not (Test-Path "$tm\node_modules\@truckermudgeon\base\package.json")) {
  Push-Location $tm
  # --ignore-scripts: skips the native trucksim-telemetry / parser addons (no
  # MSVC needed); pc\patches\scsSDKTelemetry.js replaces the telemetry addon.
  try { Exec { npm ci --ignore-scripts --no-audit --no-fund } 'npm ci (tm-maps)' } finally { Pop-Location }
}

Step 'PC agent dependencies (pc\agent)'
if (-not (Test-Path "$Root\pc\agent\node_modules\ws")) {
  Push-Location "$Root\pc\agent"
  try { Exec { npm ci --ignore-scripts --no-audit --no-fund } 'npm ci (agent)' } finally { Pop-Location }
}

Step 'PC app (bin\RigBuddy.exe)'
$running = Get-Process RigBuddy, ETS2Nav -ErrorAction SilentlyContinue # ETS2Nav = name before the rename
if ($running) { & "$Root\bin\$($running[0].Name).exe" --quit | Out-Null; $running | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue }
Exec { dotnet publish "$Root\pc\host\RigBuddy.csproj" -c Release -o "$Root\bin" --nologo -v q } 'dotnet publish'
Remove-Item "$Root\bin\ETS2Nav.*", (Join-Path ([Environment]::GetFolderPath('Programs')) 'ETS2 Nav.lnk') -ErrorAction SilentlyContinue
$lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Rig Buddy.lnk'
$sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sc.TargetPath = "$Root\bin\RigBuddy.exe"
$sc.WorkingDirectory = "$Root\bin"
$sc.Description = 'Rig Buddy PC servisi'
$sc.Save()
Write-Host "  Start menu shortcut: $lnk"

Step 'SCS telemetry plugin'
$pluginDir = Join-Path $vendor 'scs-sdk-plugin'
$dll = Get-ChildItem $pluginDir -Recurse -Filter 'scs-telemetry.dll' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $dll) {
  New-Item -ItemType Directory -Force $pluginDir | Out-Null
  $zip = Join-Path $pluginDir 'build-windows-latest.zip'
  Get-File $PluginUrl $zip
  Expand-Archive $zip (Join-Path $pluginDir 'extracted') -Force
  $dll = Get-ChildItem $pluginDir -Recurse -Filter 'scs-telemetry.dll' | Select-Object -First 1
}
if (-not $SkipPlugin) {
  $games = Find-TruckSimGames
  foreach ($name in 'ETS2', 'ATS') {
    if (-not $games[$name]) { Write-Host "  $name not found, skipped"; continue }
    $dest = Join-Path $games[$name] 'bin\win_x64\plugins'
    try {
      New-Item -ItemType Directory -Force $dest | Out-Null
      Copy-Item $dll.FullName $dest -Force
      Write-Host "  $name -> $dest"
    } catch {
      Write-Warning "could not write $dest (run as administrator, or copy $($dll.FullName) there yourself)"
    }
  }
}

Step 'map label fonts (android assets\glyphs)'
# OpenMapTiles fonts (SIL OFL), only the ranges Latin/Turkish/Cyrillic labels need.
$glyphs = Join-Path $Root 'android\app\src\main\assets\glyphs'
foreach ($font in 'Klokantech Noto Sans Regular', 'Klokantech Noto Sans Bold') {
  $dir = Join-Path $glyphs $font
  New-Item -ItemType Directory -Force $dir | Out-Null
  foreach ($range in '0-255', '256-511', '512-767', '768-1023', '1024-1279', '8192-8447') {
    $out = Join-Path $dir "$range.pbf"
    if (-not (Test-Path $out)) {
      Get-File "https://fonts.openmaptiles.org/$([Uri]::EscapeDataString($font))/$range.pbf" $out
    }
  }
}

Step 'Android SDK location (android\local.properties)'
$props = Join-Path $Root 'android\local.properties'
$sdk = Get-AndroidSdk
if (Test-Path $props) { Write-Host '  already there' }
elseif ($sdk) {
  Set-Content -Encoding ascii $props ('sdk.dir=' + ($sdk -replace '\\', '\\' -replace ':', '\:'))
  Write-Host "  sdk.dir=$sdk"
} else {
  Write-Warning 'Android SDK not found; install Android Studio (or the command-line tools) before building the APK.'
}

if (-not $SkipFirewall) {
  Step 'firewall (head unit -> this PC; asks for admin)'
  & "$PSScriptRoot\allow-firewall.ps1"
}

Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Write-Host "`nPC setup done. Next:" -ForegroundColor Green
Write-Host '  1. map data from your game files:  pipeline\build-map-data.ps1   (WSL, ~30-60 min)'
Write-Host '  2. APK + head unit:                setup\install-headunit.ps1 -Device <ip:port> -PcHost <pc ip>'
Write-Host '  3. start "Rig Buddy" (Start menu); it runs in the tray. Tray menu: "Windows acilisinda baslat".'
