#!/usr/bin/env bash
# Builds the Android app the Maestro flows drive (docs/roadmap/maestro-plan.md
# 1.1): the release variant, so the JS bundle is embedded and no Metro runs,
# x86_64 only (the emulator), signed with the debug key, with the e2e build
# profile that compiles in the test-only sign-in link. Never upload this APK:
# scripts/check-release-bundle.sh would (rightly) refuse its bundle.
#
#   nix develop .#android -c bash apps/mobile/maestro/ops/build-apk.sh [out.apk]
#
# Run from a checkout after `pnpm install --frozen-lockfile`.
set -euo pipefail

app=$(cd "$(dirname "$0")/../.." && pwd)
out=${1:-$app/maestro-app.apk}

export RETROSPEND_BUILD_PROFILE=e2e EXPO_PUBLIC_E2E=1
# The commit count is unknown in a synced tree; a plain build is number 1.
cd "$app"
# android/ is generated (continuous native generation) and never committed.
CI=1 pnpm exec expo prebuild --platform android --clean --no-install
(cd android && ./gradlew --no-daemon -Dorg.gradle.jvmargs=-Xmx4g \
	-PreactNativeArchitectures=x86_64 assembleRelease)

apk=$app/android/app/build/outputs/apk/release/app-release.apk
[[ -f $apk ]] || { echo "no APK at $apk" >&2; exit 1; }
# The debug key signs it (no keystore is set), which is all an emulator needs.
cp "$apk" "$out"
echo "APK: $out ($(du -h "$out" | cut -f1))"
