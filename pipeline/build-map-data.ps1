# Builds the map/route/game data from YOUR game installation (every map DLC
# you own is picked up), via WSL, then the head-unit icon sheet.
#
#   powershell -ExecutionPolicy Bypass -File pipeline\build-map-data.ps1
#
# Needs WSL (Ubuntu) with Node.js 22+; the script installs tippecanoe etc.
# Game folders are found through Steam; override with $env:ETS2_DIR / $env:ATS_DIR.
# Re-run after a game update or a new map DLC (delete data\ and the WSL
# ~/tm-maps/out folder first so everything is re-parsed).
. "$PSScriptRoot\..\setup\lib.ps1"

Step 'game folders'
$games = Find-TruckSimGames
if (-not $games.ETS2 -or -not $games.ATS) {
  throw "ETS2 and ATS are both needed (found ETS2='$($games.ETS2)' ATS='$($games.ATS)'). Set ETS2_DIR / ATS_DIR."
}
Write-Host "  ETS2: $($games.ETS2)`n  ATS:  $($games.ATS)"
if (-not (Get-Command wsl -ErrorAction SilentlyContinue)) { throw 'WSL not found: wsl --install -d Ubuntu' }

Step 'WSL pipeline (parser, navigation data, tiles)'
$script = ConvertTo-WslPath "$PSScriptRoot\build-map-data.sh"
Exec { wsl -e bash $script (ConvertTo-WslPath $games.ETS2) (ConvertTo-WslPath $games.ATS) } 'build-map-data.sh'

Step 'head-unit icon sheet (android assets\sprites)'
# Only the icons the app's map style uses; the full sheet is ~21 MB of GPU texture.
$java = Join-Path (Get-JavaHome) 'bin\java.exe'
$src = Join-Path $Root 'data\sprites'
$icons = 'gas_ico service_ico parking_ico dealer_ico garage_large_ico recruitment_ico weigh_station_ico ' +
  'weigh_ico toll_ico border_ico dot dotdot roadwork railcrossing viewpoint port_overlay train_ico'
Exec { & $java "$PSScriptRoot\SpriteSubset.java" "$src\sprites@2x.json" "$src\sprites@2x.png" `
    "$Root\android\app\src\main\assets\sprites" ($icons -split ' ') } 'SpriteSubset'

Write-Host "`nMap data ready in data\. Rebuild/install the APK: setup\install-headunit.ps1" -ForegroundColor Green
