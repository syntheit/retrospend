#!/usr/bin/env bash
# Builds the Android debug APK from a clean native project, then runs the
# Google-free check on the resolved Gradle tree. Needs the Android SDK, so run
# it inside the flake's android shell, from the repo root, after
# `pnpm install --frozen-lockfile`:
#
#   nix develop .#android -c bash apps/mobile/scripts/android-debug.sh
set -euo pipefail

app=$(cd "$(dirname "$0")/.." && pwd)
cd "$app"

# android/ is generated (continuous native generation) and never committed.
CI=1 pnpm exec expo prebuild --platform android --clean --no-install

# arm64-v8a for phones, x86_64 for the emulator: half the native compile of
# all four ABIs. Gradle's memory stays bounded on shared machines.
(cd android && ./gradlew --no-daemon -Dorg.gradle.jvmargs=-Xmx4g \
  -PreactNativeArchitectures=arm64-v8a,x86_64 assembleDebug)

bash "$app/scripts/check-google-free.sh"

apk="$app/android/app/build/outputs/apk/debug/app-debug.apk"
echo "APK: $apk ($(du -h "$apk" | cut -f1))"
