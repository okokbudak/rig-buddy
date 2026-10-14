#!/usr/bin/env bash
# Builds the Octopus firmware (gauges, or hello) with the three build properties EVERY Octopus build needs,
# checks that the vector table is linked at 0x08008000 and, for gauges, compares the result with the binary
# that is on the board (out/firmware-on-board.bin, if you keep one there). It does not flash anything.
#
#   bash hardware/octopus-fw/build.sh [gauges|hello]
#
# Needs arduino-cli and the STMicroelectronics:stm32 core 3.0.0 (arduino-cli core install STMicroelectronics:stm32@3.0.0).
# Build products go to $SIMDASH_BUILD (default ~/simdash-build), the gauges binary is also copied to out/firmware.bin.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
[ "$(pwd)" = "$HERE" ] || { echo "wrong directory"; exit 1; }
export PATH="$HOME/.local/bin:$PATH"
command -v arduino-cli >/dev/null || { echo "arduino-cli not found"; exit 1; }

BUILD="${SIMDASH_BUILD:-$HOME/simdash-build}"
SKETCH="${1:-gauges}"
case "$SKETCH" in gauges|hello) ;; *) echo "unknown sketch '$SKETCH' (gauges, hello)"; exit 1;; esac

FQBN='STMicroelectronics:stm32:GenF4:pnum=GENERIC_F446ZETX,usb=CDCgen,xusb=FS'
# Why these three, all of them:
#   build.flash_offset=0x8000   the application starts at 0x08008000 (the BTT bootloader owns 0x08000000);
#                               without it the binary is linked for 0x08000000 and the board does not start
#   upload.maximum_size=360448  keeps the firmware below 0x08060000, the settings sector (CFG SAVE)
#   build.extra_flags           the board has a 12 MHz crystal
PROPS=(build.flash_offset=0x8000 upload.maximum_size=360448 'build.extra_flags=-DHSE_VALUE=12000000UL')
args=(compile --fqbn "$FQBN" --build-path "$BUILD/$SKETCH" --warnings default)
for p in "${PROPS[@]}"; do args+=(--build-property "$p"); done

mkdir -p "$BUILD"
echo "building $SKETCH"
log="$(arduino-cli "${args[@]}" "$SKETCH" 2>&1)" || { printf '%s\n' "$log" | grep -E 'error|Error' | head -10; echo "BUILD FAILED"; exit 1; }
printf '%s\n' "$log" | grep -m1 'Sketch uses' || true

# the vector table must be exactly at 0x08008000 (checking the reset vector VALUE is not enough: it is an address inside the image)
OBJDUMP="$(ls "$HOME"/.arduino15/packages/STMicroelectronics/tools/xpack-arm-none-eabi-gcc/*/bin/arm-none-eabi-objdump 2>/dev/null | head -1 || true)"
ELF="$BUILD/$SKETCH/$SKETCH.ino.elf"
[ -n "$OBJDUMP" ] && [ -f "$ELF" ] || { echo "cannot verify the link address (no objdump or no ELF): do NOT flash this"; exit 1; }
base="$("$OBJDUMP" -h "$ELF" | awk '/\.isr_vector/ {print $4; exit}')"
[ "$base" = "08008000" ] || { echo ".isr_vector is at 0x${base:-?}, must be 0x08008000: do NOT flash this"; exit 1; }
echo ".isr_vector at 0x$base: ok"

BIN="$BUILD/$SKETCH/$SKETCH.ino.bin"
echo "$(basename "$BIN"): $(stat -c %s "$BIN") bytes"
if [ "$SKETCH" = "gauges" ]; then
  mkdir -p out
  cp -- "$BIN" out/firmware.bin
  echo "copied to out/firmware.bin (what flash.ps1 writes)"
  if [ -f out/firmware-on-board.bin ]; then
    n="$( (cmp -l out/firmware-on-board.bin "$BIN" 2>/dev/null || true) | wc -l )"   # cmp exits 1 when the files differ
    echo "bytes that differ from out/firmware-on-board.bin: $n (9 is normal when that file was built on Windows: the compiler's path text win32-x64 / linux-x64)"
  fi
fi
echo "done (nothing was flashed)"
