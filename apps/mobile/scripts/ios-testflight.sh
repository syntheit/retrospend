#!/usr/bin/env bash
# Builds a Release archive of the iOS app on the Mac mini, exports it for App
# Store Connect and uploads it to TestFlight. Run from harbor:
#
#   bash apps/mobile/scripts/ios-testflight.sh
#
# The build number is the commit count, so every commit that ships is newer
# than the last. The App Store Connect API key stays on the mini
# (~/.appstoreconnect/env). It needs the role App Manager or Admin, and the
# app record for app.retrospend must exist (both are web UI steps; the script
# says which one is missing). Without the record the build still ends in a
# signed .ipa on the mini: ~/rs-ios-plus/archive/export.
#
# Takes the shared simulator lock on the mini while it builds (MOBILE-RULES)
# and stops before a build when the mini has less than MIN_FREE_GB (8) free.
# Reuses the checkout and DerivedData in ~/rs-ios-plus. Env: MINI (default
# "mini"), MIN_FREE_GB, LOCK_WAIT_MIN (default 60).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
mini=${MINI:-mini}
lock=/tmp/retrospend-sim.lock

free=$(ssh "$mini" "df -Pk / | awk 'NR==2 {print int(\$4 / 1048576)}'")
if ((free < ${MIN_FREE_GB:-8})); then
	echo "The mini has ${free} GB free, below ${MIN_FREE_GB:-8}. Free space first." >&2
	exit 1
fi

# mkdir is the lock: it fails while someone else holds it.
held=0
for ((i = 0; i < ${LOCK_WAIT_MIN:-60}; i++)); do
	if ssh "$mini" "mkdir $lock" 2>/dev/null; then
		held=1
		break
	fi
	echo "Simulator lock on the mini is held; retrying in a minute"
	sleep 60
done
((held)) || { echo "Could not take $lock on the mini" >&2 && exit 1; }
trap 'ssh "$mini" "rmdir $lock"' EXIT

RETROSPEND_BUILD_NUMBER=$(git -C "$here" rev-list --count HEAD)
export RETROSPEND_BUILD_NUMBER
echo "Build number: $RETROSPEND_BUILD_NUMBER"
# The connect screen starts on the dev server (the field stays editable).
export RETROSPEND_DEFAULT_SERVER=${RETROSPEND_DEFAULT_SERVER:-https://dev.retrospend.app}
RS_REMOTE=rs-ios-plus/retrospend RS_WORK=/Users/daniel/rs-ios-plus \
	bash "$here/ios-build.sh" testflight
