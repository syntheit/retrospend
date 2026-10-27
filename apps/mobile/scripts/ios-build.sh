#!/usr/bin/env bash
# Builds the iOS app on the Mac mini from this checkout, run from harbor:
#
#   bash apps/mobile/scripts/ios-build.sh [all|device|simulator|sim-build]
#
# all (the default): the signed device build, the simulator run with a
# screenshot, then one install and launch on the iPhone. device: build,
# install and launch on the iPhone only. simulator: the simulator run only.
# sim-build: build the simulator app only (no install), for UI test runs.
#
# The repo is copied to mini:~/rs-ios/retrospend (no git, no env files, no
# build output), then apps/mobile/scripts/ios-mini.sh does the rest there.
# Env: MINI (ssh host, default "mini"), IPHONE (UDID of the phone),
# SHOTS (where the screenshot lands, default docs/ui-overhaul/impl/shots/ios).
set -euo pipefail

target=${1:-all}
case "$target" in device | simulator | sim-build | testflight | all) ;; *)
	echo "usage: $0 [all|device|simulator|sim-build|testflight]" >&2
	exit 2
	;;
esac

mini=${MINI:-mini}
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
remote=${RS_REMOTE:-rs-ios/retrospend}

ssh "$mini" "mkdir -p ~/$remote"

# Excluded paths are also left alone on the mini (no --delete-excluded), so
# its node_modules and generated ios/ survive between runs. Secrets never
# leave harbor: env files, keys and certificates are excluded by pattern.
rsync -a --delete \
	--exclude node_modules --exclude .next --exclude .git --exclude .claude \
	--exclude '.env' --exclude '.env.*' --exclude '*.pem' --exclude '*.p8' \
	--exclude '*.p12' --exclude '*.mobileprovision' \
	--exclude /docs --exclude /coverage --exclude /test-results \
	--exclude /playwright-report --exclude /public/images/flags \
	--exclude /public/images/crypto \
	--exclude /apps/mobile/ios --exclude /apps/mobile/android \
	--exclude /apps/mobile/.expo \
	"$repo/" "$mini:$remote/"

# An ssh session has no per-user security services (secd, trustd), so
# codesign fails there with errSecInternalComponent. launchctl asuser runs
# the build in the logged-in user's session instead (passwordless sudo; the
# owner stays logged in on the mini). timeout bounds a stuck run.
status=0
ssh "$mini" "timeout 3600 sudo launchctl asuser \$(id -u) sudo -H -u \$(id -un) \
	env IPHONE='${IPHONE:-}' RS_WORK='${RS_WORK:-}' \
	RETROSPEND_BUILD_NUMBER='${RETROSPEND_BUILD_NUMBER:-}' RETROSPEND_DEFAULT_SERVER='${RETROSPEND_DEFAULT_SERVER:-}' bash -l ~/$remote/apps/mobile/scripts/ios-mini.sh $target" ||
	status=$?

# The screenshot comes back even when the phone step at the end failed.
if [[ "$target" != device && "$target" != testflight ]] && ssh "$mini" "ls rs-ios/shots/*.png" >/dev/null 2>&1; then
	shots=${SHOTS:-/home/matv/Projects/retrospend/docs/ui-overhaul/impl/shots/ios}
	mkdir -p "$shots"
	scp -q "$mini:rs-ios/shots/*.png" "$shots/"
	echo "Screenshots: $shots"
fi
exit "$status"
