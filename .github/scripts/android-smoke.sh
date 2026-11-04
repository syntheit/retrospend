#!/usr/bin/env bash
# Runs inside the emulator (reactivecircus/android-emulator-runner runs each
# line of `script:` as its own shell, so the steps live in one file).
# Installs the debug APK, starts the app, waits, then fails if the process
# died or logcat holds a fatal exception. The workflow uploads the screenshot
# and logcat either way.
set -euo pipefail

apk=apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
pkg=app.retrospend
out=smoke
mkdir -p "$out"

adb logcat -c
adb install -r "$apk"
adb shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1
# Long enough for the embedded bundle to load and the first screen to draw.
sleep 25

adb exec-out screencap -p >"$out/android.png"
adb logcat -d >"$out/logcat.txt"

status=0
if ! adb shell pidof "$pkg" >/dev/null; then
  echo "FAIL: $pkg is not running" >&2
  status=1
fi
if grep -E "FATAL EXCEPTION|ANR in $pkg|Unable to load script" "$out/logcat.txt"; then
  echo "FAIL: crash in logcat" >&2
  status=1
fi
exit "$status"
