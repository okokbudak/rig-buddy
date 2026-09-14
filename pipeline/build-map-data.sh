#!/bin/bash
# Builds everything ETS2 Nav needs from YOUR installed game files (all DLC map
# packs you own are included automatically). Runs in WSL (Ubuntu); the Windows
# wrapper pipeline\build-map-data.ps1 finds the game folders and calls this.
#
# usage: build-map-data.sh "<ETS2 dir>" "<ATS dir>"      (WSL paths, /mnt/...)
#
# Output (in <repo>/data):
#   europe-navigation.zip, usa-navigation.zip   route/search data for the server
#   ets2.mbtiles                                map tiles for the head unit
#   game/*.json                                 cities/companies/cargoes (agent)
#   sprites/sprites@2x.{json,png}               full icon sheet (for SpriteSubset)
#
# The navigation server loads both maps, so both games are needed.
set -euo pipefail
ETS2_DIR=${1:?ETS2 dir}
ATS_DIR=${2:?ATS dir}
HERE="$(cd "$(dirname "$0")" && pwd)"
DATA="${ETS2NAV_DATA:-$(dirname "$HERE")/data}"
export ETS2NAV_DATA="$DATA"
export TM_MAPS="${TM_MAPS:-$HOME/tm-maps}"
TM_MAPS_REV=d56d0e3 # keep in sync with setup/setup-pc.ps1
export NODE_OPTIONS=--max-old-space-size=12288
start=$(date +%s)
step() { echo "=== $* ($(( $(date +%s) - start ))s)"; }

step tools
need=()
command -v node >/dev/null || { echo "node (>= 22) is required in WSL: https://nodejs.org or nvm"; exit 1; }
for t in git make g++ python3 tippecanoe tile-join sqlite3; do command -v $t >/dev/null || need+=($t); done
if [ ${#need[@]} -gt 0 ]; then
  echo "installing: build tools, tippecanoe, sqlite3"
  SUDO=$([ "$(id -u)" = 0 ] || echo sudo)
  $SUDO apt-get update -qq && $SUDO apt-get install -y -qq build-essential python3 git tippecanoe sqlite3
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

step parse ETS2
[ -f out/parser/europe-cities.json ] || npx parser -i "$ETS2_DIR" -o out/parser
step parse ATS
[ -f out/parser/usa-cities.json ] || npx parser -i "$ATS_DIR" -o out/parser

step navigation data
make ETS2_DIR="$ETS2_DIR" ATS_DIR="$ATS_DIR" out/europe-navigation.zip out/usa-navigation.zip

step spritesheet
[ -f out/sprites@2x.json ] || npx generator spritesheet -m usa -m europe -i out/parser -o out

step ETS2 tiles
"$HERE/build-tiles.sh" ets2

step copy to "$DATA"
mkdir -p "$DATA/game" "$DATA/sprites"
cp out/europe-navigation.zip out/usa-navigation.zip "$DATA/"
for map in europe usa; do
  for kind in cities companies companyDefs cargoes countries; do
    cp out/parser/$map-$kind.json "$DATA/game/"
  done
done
cp out/sprites@2x.json out/sprites@2x.png "$DATA/sprites/"

step done
ls -la "$DATA" "$DATA/game"
