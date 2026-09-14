#!/bin/bash
# Builds everything Rig Buddy needs from YOUR installed game files (all DLC map
# packs you own are included automatically), for whichever of the two games is
# installed. Runs in WSL (Ubuntu); the Windows wrapper pipeline\build-map-data.ps1
# finds the game folders and calls this.
#
# usage: build-map-data.sh "<ETS2 dir>|-" "<ATS dir>|-"   (WSL paths, /mnt/...; - = not installed)
#
# Output (in <repo>/data), per installed game:
#   europe-navigation.zip / usa-navigation.zip   route/search data for the server
#   ets2.mbtiles / ats.mbtiles                   map tiles the app downloads
#   game/<map>-*.json                            cities/companies/cargoes (agent)
#   sprites/sprites@2x.{json,png}                full icon sheet (for SpriteSubset)
set -euo pipefail
ETS2_DIR=${1:--}
ATS_DIR=${2:--}
[ "$ETS2_DIR" != - ] || [ "$ATS_DIR" != - ] || { echo "neither ETS2 nor ATS given"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
DATA="${ETS2NAV_DATA:-$(dirname "$HERE")/data}"
export ETS2NAV_DATA="$DATA"
export TM_MAPS="${TM_MAPS:-$HOME/tm-maps}"
TM_MAPS_REV=d56d0e3 # keep in sync with setup/setup-pc.ps1
export NODE_OPTIONS=--max-old-space-size=12288
start=$(date +%s)
step() { echo "=== $* ($(( $(date +%s) - start ))s)"; }

MAPS=() # generator map names of the installed games
[ "$ETS2_DIR" != - ] && MAPS+=(europe)
[ "$ATS_DIR" != - ] && MAPS+=(usa)
game_of() { [ "$1" = usa ] && echo ats || echo ets2; }

step tools
need=()
command -v node >/dev/null || { echo "node (>= 22) is required in WSL: https://nodejs.org or nvm"; exit 1; }
for t in git make zip g++ python3 tippecanoe tile-join sqlite3; do command -v $t >/dev/null || need+=($t); done
if [ ${#need[@]} -gt 0 ]; then
  echo "installing: build tools, tippecanoe, sqlite3"
  SUDO=$([ "$(id -u)" = 0 ] || echo sudo)
  $SUDO apt-get update -qq && $SUDO apt-get install -y -qq build-essential python3 git zip tippecanoe sqlite3
fi

step "tm-maps checkout ($TM_MAPS @ $TM_MAPS_REV)"
if [ ! -d "$TM_MAPS/.git" ]; then
  git clone https://github.com/truckermudgeon/maps.git "$TM_MAPS"
fi
git -C "$TM_MAPS" fetch -q origin || true
git -C "$TM_MAPS" checkout -q $TM_MAPS_REV
cd "$TM_MAPS"
[ -d node_modules ] || npm ci
mkdir -p out/parser

if [ "$ETS2_DIR" != - ]; then
  step parse ETS2
  [ -f out/parser/europe-cities.json ] || npx parser -i "$ETS2_DIR" -o out/parser
fi
if [ "$ATS_DIR" != - ]; then
  step parse ATS
  [ -f out/parser/usa-cities.json ] || npx parser -i "$ATS_DIR" -o out/parser
fi

step navigation data
MAKE_FLAGS=()
if [ "$ATS_DIR" = - ]; then
  # Upstream bundles US town labels (built from ATS) into both zips; the server
  # only needs them for ATS, so an ETS2-only build gets an empty file and make
  # is told not to rebuild it (which would require ATS).
  echo '{"type":"FeatureCollection","features":[]}' > out/extra-labels.geojson
  MAKE_FLAGS+=(-o out/extra-labels.geojson)
fi
TARGETS=()
for map in "${MAPS[@]}"; do TARGETS+=(out/$map-navigation.zip); done
make "${MAKE_FLAGS[@]}" ETS2_DIR="$ETS2_DIR" ATS_DIR="$ATS_DIR" "${TARGETS[@]}"

step spritesheet
if [ ! -f out/sprites@2x.json ]; then
  npx generator spritesheet $(printf -- '-m %s ' "${MAPS[@]}") -i out/parser -o out
fi

for map in "${MAPS[@]}"; do
  step "$(game_of $map) tiles"
  "$HERE/build-tiles.sh" "$(game_of $map)"
done

step copy to "$DATA"
mkdir -p "$DATA/game" "$DATA/sprites"
for map in "${MAPS[@]}"; do
  cp out/$map-navigation.zip "$DATA/"
  for kind in cities companies companyDefs cargoes countries; do
    cp out/parser/$map-$kind.json "$DATA/game/"
  done
done
cp out/sprites@2x.json out/sprites@2x.png "$DATA/sprites/"

step done
ls -la "$DATA" "$DATA/game"
