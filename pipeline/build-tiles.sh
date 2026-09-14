#!/bin/bash
# Builds the head-unit MBTiles for one game from the generator's GeoJSON.
# Runs in WSL, inside the Linux tm-maps checkout (TM_MAPS, default ~/tm-maps),
# after `parser` has written out/parser. usage: build-tiles.sh ets2|ats
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DATA="${ETS2NAV_DATA:-$(dirname "$HERE")/data}"
GAME=${1:-ets2}
MAP=$([ "$GAME" = ats ] && echo usa || echo europe)
cd "${TM_MAPS:-$HOME/tm-maps}"
export NODE_OPTIONS=--max-old-space-size=12288
if [ ! -f out/$GAME.geojson ]; then
  npx generator map -h -m $MAP -i out/parser -o out \
    --dataOverridesPath packages/clis/generator/resources/trucksim-overrides.json -t geojson
fi
node "$HERE/postprocess-geojson.js" out/$GAME.geojson out/$GAME-nav.geojson
ATTRS="-y type -y roadType -y color -y hidden -y poiType -y sprite -y scaleRank -y capital -y name"
# -B = base zoom of each pass, so nothing gets dot-dropped
tippecanoe -Z4 -z8 -B 4 -b 10 -l $GAME $ATTRS --no-tile-size-limit --force \
  -o out/$GAME-low.mbtiles out/$GAME-nav-low.geojson > out/tippecanoe-$GAME-low.log 2>&1
tippecanoe -Z9 -z13 -B 9 -b 10 -l $GAME $ATTRS --no-tile-size-limit --force \
  -o out/$GAME-high.mbtiles out/$GAME-nav-high.geojson > out/tippecanoe-$GAME-high.log 2>&1
tile-join --force --no-tile-size-limit -o out/$GAME-nav.mbtiles out/$GAME-low.mbtiles out/$GAME-high.mbtiles
mkdir -p "$DATA"
cp out/$GAME-nav.mbtiles "$DATA/$GAME.mbtiles"
sqlite3 "$DATA/$GAME.mbtiles" \
  "select zoom_level, count(*), max(length(tile_data)), cast(avg(length(tile_data)) as int) from tiles group by zoom_level;"
ls -la "$DATA/$GAME.mbtiles"
