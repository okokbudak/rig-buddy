#!/bin/bash
# Dev helper: build the debug APK, install it on the head unit, launch, wait, screenshot.
# usage: dev/dev-deploy.sh [waitSeconds] [screenshot.png] [--no-build]
# Settings come from dev/dev.env (copy dev/dev.env.example).
set -e
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT/dev/dev.env" ] && . "$ROOT/dev/dev.env"
: "${ADB_DEVICE:?set ADB_DEVICE (head unit ip:port) in dev/dev.env}"
: "${PC_HOST:?set PC_HOST (gaming PC LAN IP) in dev/dev.env}"
ADB_EXE="${ADB_EXE:-$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe}"
ADB="$ADB_EXE -s $ADB_DEVICE"
case "$ADB_DEVICE" in *:*) "$ADB_EXE" connect "$ADB_DEVICE" > /dev/null ;; esac
WAIT=${1:-20}
SHOT=${2:-$ROOT/local/screenshots/shot.png}
mkdir -p "$(dirname "$SHOT")"
if [ "$3" != "--no-build" ]; then
  if ! (cd "$ROOT/android" && "$ROOT/vendor/gradle/bin/gradle" assembleDebug -q --console=plain > /tmp/gradle.log 2>&1); then
    grep -E "error|FAIL|What went wrong" -A2 /tmp/gradle.log | head -30
    echo "BUILD FAILED"; exit 1
  fi
  $ADB install -r "$(cygpath -m "$ROOT/android/app/build/outputs/apk/debug/app-debug.apk")" | tail -1
fi
$ADB logcat -c
$ADB shell am force-stop tr.ets2nav
$ADB shell am start -n tr.ets2nav/.MainActivity --es host "$PC_HOST" > /dev/null
end=$((SECONDS + WAIT)); while [ $SECONDS -lt $end ]; do :; done 2>/dev/null
$ADB exec-out screencap -p > "$SHOT"
$ADB logcat -d -v time | grep -E "ETS2Nav|NavClient|TileServer|AndroidRuntime|FATAL|Mbgl" | grep -v chatty | tail -25
