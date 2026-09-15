#!/bin/bash
# Cross-compiles the tm-maps parser's two native addons (cityhash: SCS file
# path hashes, gdeflate: HashFS v2 decompression) for Windows x64 with MinGW,
# so neither users nor the installer need Visual Studio. They only use the
# stable Node-API C ABI, which MinGW-built DLLs can call in node.exe.
#
# Runs in WSL/Linux: sudo apt install g++-mingw-w64-x86-64-posix, and Node
# headers in ~/.cache/node-gyp/<version> (any node-gyp run creates them).
# usage: build-addons.sh <tm-maps checkout> [out dir, default: pc/native/win-x64]
set -euo pipefail
TM=${1:?tm-maps checkout}
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT=${2:-$HERE/win-x64}
SRC="$TM/packages/clis/parser"
NODE_INC=$(ls -d ~/.cache/node-gyp/*/include/node | sort -V | tail -1)
ADDON_INC="$TM/node_modules/node-addon-api"
CXX=x86_64-w64-mingw32-g++-posix
CC=x86_64-w64-mingw32-gcc-posix
DLLTOOL=x86_64-w64-mingw32-dlltool
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

# import library for the Node-API functions exported by node.exe
{
  echo "LIBRARY node.exe"
  echo "EXPORTS"
  grep -ohE '\b(napi|node_api)_[a-z0-9_]+\(' "$NODE_INC"/js_native_api.h "$NODE_INC"/node_api.h \
    | tr -d '(' | sort -u
} > "$TMP/node.def"
$DLLTOOL -d "$TMP/node.def" -l "$TMP/libnode.a" -D node.exe

FLAGS=(-O2 -DNAPI_DISABLE_CPP_EXCEPTIONS -DNAPI_VERSION=8 -DBUILDING_NODE_EXTENSION
  -I"$NODE_INC" -I"$ADDON_INC")
# -static: also winpthread (the posix toolchain's threads), which a normal
# Windows PC doesn't have; the addons may only import node.exe and system DLLs
LINK=(-shared -static -static-libgcc -static-libstdc++ -Wl,--no-undefined -L"$TMP" -lnode)

echo "cityhash.node"
$CXX "${FLAGS[@]}" "$SRC/cityhash/city.cc" "$SRC/cityhash/cityhash.cc" "${LINK[@]}" -o "$OUT/cityhash.node"

echo "gdeflate.node"
LD="$SRC/gdeflate/libdeflate"
for f in lib/deflate_decompress.c lib/utils.c lib/arm/cpu_features.c lib/x86/cpu_features.c lib/gdeflate_decompress.c; do
  # stdlib.h first: libdeflate later #defines names mingw declares there (_rotr64)
  $CC -O2 -include stdlib.h -I"$LD" -c "$LD/$f" -o "$TMP/$(echo "$f" | tr '/' '_').o"
done
$CXX "${FLAGS[@]}" -I"$LD" "$SRC/gdeflate/gdeflate.cc" "$TMP"/*.o "${LINK[@]}" -o "$OUT/gdeflate.node"

# guard: a DLL beyond node.exe and Windows' own fails to load on users' PCs
# (but not on a dev PC that happens to have it on PATH, e.g. from Git)
for f in "$OUT"/cityhash.node "$OUT"/gdeflate.node; do
  imports=$(x86_64-w64-mingw32-objdump -p "$f" | sed -n 's/.*DLL Name: //p')
  extra=$(echo "$imports" | grep -viE '^(node\.exe|kernel32\.dll|msvcrt\.dll|user32\.dll|advapi32\.dll|ws2_32\.dll|api-ms-win-.+\.dll)$' || true)
  if [ -n "$extra" ]; then echo "$(basename "$f") imports $extra: not on a normal Windows PC" >&2; exit 1; fi
  echo "$(basename "$f") imports: $(echo $imports)"
done
ls -la "$OUT"
