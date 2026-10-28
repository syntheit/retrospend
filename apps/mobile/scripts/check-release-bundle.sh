#!/usr/bin/env bash
# Fails when a release build could carry the dev tooling: the dev auto sign-in
# (server, email and password baked in by EXPO_PUBLIC_DEV_*) and the gallery
# flag. Metro inlines EXPO_PUBLIC_* values into the bundle, so names do not
# survive there; the check looks for the dev component's name instead, and
# for the variables in the build environment and in apps/mobile/.env*.
#
#   bash apps/mobile/scripts/check-release-bundle.sh [bundle-dir]
#
# bundle-dir is the output of `expo export` (default: apps/mobile/dist).
set -euo pipefail

app=$(cd "$(dirname "$0")/.." && pwd)
dir=${1:-$app/dist}
fail=0

for name in $(env | cut -d= -f1 | grep -E '^EXPO_PUBLIC_(DEV_|GALLERY$)' || true); do
	echo "FAIL: $name is set in the environment" >&2
	fail=1
done

if grep -lE '^\s*EXPO_PUBLIC_(DEV_|GALLERY\s*=)' "$app"/.env* 2>/dev/null; then
	echo "FAIL: dev variables in apps/mobile/.env*" >&2
	fail=1
fi

if [[ ! -d "$dir" ]]; then
	echo "FAIL: no bundle at $dir (run expo export first)" >&2
	exit 2
fi
# Hermes bytecode keeps string literals, so a grep -a finds the component name.
if grep -raql 'RetrospendDevAutoSignIn' "$dir"; then
	echo "FAIL: the dev auto sign-in is in the bundle at $dir" >&2
	fail=1
fi
if grep -raql 'RetrospendDevComposerTour' "$dir"; then
	echo "FAIL: the dev composer tour is in the bundle at $dir" >&2
	fail=1
fi

((fail == 0)) && echo "OK: no dev tooling in the release bundle"
exit "$fail"
