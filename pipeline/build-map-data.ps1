# Builds the map/route/game data from YOUR game installation (every map DLC
# you own is picked up) for ETS2 and/or ATS, whichever is installed, via WSL,
# then the app's icon sheet.
#
#   powershell -ExecutionPolicy Bypass -File pipeline\build-map-data.ps1
#
# Needs WSL (Ubuntu) with Node.js 22+; the script installs tippecanoe etc.
# Game folders are found through Steam; override with $env:ETS2_DIR / $env:ATS_DIR.
# Re-run after a game update or a new map DLC (delete data\ and the WSL
# ~/tm-maps/out folder first so everything is re-parsed).
. "$PSScriptRoot\..\setup\lib.ps1"

Step 'game folders'
# Data is built for each installed game; one of the two is enough.
$games = Find-TruckSimGames
if (-not $games.ETS2 -and -not $games.ATS) {
  throw 'Neither ETS2 nor ATS was found in your Steam libraries. Set ETS2_DIR / ATS_DIR.'
}
Write-Host "  ETS2: $(if ($games.ETS2) { $games.ETS2 } else { '(not installed, skipped)' })"
Write-Host "  ATS:  $(if ($games.ATS) { $games.ATS } else { '(not installed, skipped)' })"
if (-not (Get-Command wsl -ErrorAction SilentlyContinue)) { throw 'WSL not found: wsl --install -d Ubuntu' }

Step 'WSL pipeline (parser, navigation data, tiles)'
$script = ConvertTo-WslPath "$PSScriptRoot\build-map-data.sh"
$ets2 = if ($games.ETS2) { ConvertTo-WslPath $games.ETS2 } else { '-' }
$ats = if ($games.ATS) { ConvertTo-WslPath $games.ATS } else { '-' }
Exec { wsl -e bash $script $ets2 $ats } 'build-map-data.sh'

Step 'head-unit icon sheet (android assets\sprites)'
# Only the icons the app's map style uses; the full sheet is ~21 MB of GPU texture.
$java = Join-Path (Get-JavaHome) 'bin\java.exe'
$src = Join-Path $Root 'data\sprites'
$icons = 'gas_ico service_ico parking_ico dealer_ico garage_large_ico recruitment_ico weigh_station_ico ' +
  'weigh_ico toll_ico border_ico dot dotdot roadwork railcrossing viewpoint port_overlay train_ico'
Exec { & $java "$PSScriptRoot\SpriteSubset.java" "$src\sprites@2x.json" "$src\sprites@2x.png" `
    "$Root\android\app\src\main\assets\sprites" ($icons -split ' ') } 'SpriteSubset'

Write-Host "`nMap data ready in data\. Rebuild/install the APK: setup\install-headunit.ps1" -ForegroundColor Green
