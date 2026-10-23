#!/usr/bin/env bash
# The Mac mini half of ios-build.sh: install, prebuild, xcodebuild, then
# install and launch. Runs on the mini from the copied repo:
#
#   bash ~/rs-ios/retrospend/apps/mobile/scripts/ios-mini.sh [all|device|simulator]
#
# Signing is Xcode automatic signing driven by the App Store Connect API key
# in ~/.appstoreconnect/env (ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH), so the
# device registration and the development certificate and profile need no
# Apple ID login (ios-signing.sh). The team comes from app.config.ts
# (ios.appleTeamId).
set -euo pipefail

target=${1:-all}
# The UDID works for both xcodebuild destinations and devicectl.
iphone=${IPHONE:-00008120-0009483E1AB9A01E}
sim_type=com.apple.CoreSimulator.SimDeviceType.iPhone-17
bundle_id=app.retrospend

app=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$app/../.." && pwd)
work=$HOME/rs-ios
derived=$work/DerivedData
logs=$work/logs
mkdir -p "$logs" "$work/shots"

# CocoaPods refuses to run without a UTF-8 locale; Homebrew's pod first.
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
export PATH=/opt/homebrew/bin:$PATH
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
command -v pod >/dev/null || HOMEBREW_NO_AUTO_UPDATE=1 brew install cocoapods

# Node from the nixpkgs pinned in flake.lock, the one harbor runs. The mini's
# own Node 24.16 fails Expo's bundle write with EBADF; 24.21 does not. Pod
# install records this node in ios/.xcode.env.local for the bundle phase.
nixpkgs=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).nodes.nixpkgs.locked.rev' \
	"$repo/flake.lock")
node_dir=$(/nix/var/nix/profiles/default/bin/nix build --no-link --print-out-paths \
	"github:NixOS/nixpkgs/$nixpkgs#nodejs_24")
export PATH=$node_dir/bin:$PATH
echo "Node $(node --version)"

# The mini's system resolver has failed on registry.npmjs.org alone while
# every other host resolved (2026-10-22). Yarn's registry serves the same
# packages, so it stands in when npm's does not answer.
if ! curl -fsS -m 10 -o /dev/null https://registry.npmjs.org/; then
	echo "registry.npmjs.org unreachable, using registry.yarnpkg.com"
	export COREPACK_NPM_REGISTRY=https://registry.yarnpkg.com
	export npm_config_registry=https://registry.yarnpkg.com/
fi

# The repo pins pnpm in packageManager; corepack runs exactly that version.
pnpm() { corepack pnpm "$@"; }

cd "$repo"
# Only the app and the workspace packages it imports. pnpm still runs the
# root's lifecycle scripts, and the web app's postinstall (Prisma) has no
# place on the mini; the app's dependencies need no install scripts.
pnpm install --frozen-lockfile --ignore-scripts --filter '@retrospend/mobile...'

cd "$app"
# ios/ is generated (continuous native generation) and never committed.
CI=1 pnpm exec expo prebuild --platform ios --clean --no-install
# EX_UPDATES_NATIVE_DEBUG makes pod install write ios/.xcode.env.updates,
# which embeds a production JS bundle (DEV off) in the Debug build. Expo's
# bundle phase otherwise skips bundling in Debug, and a dev bundle without
# Metro stops at "Cannot create devtools websocket connections in embedded
# environments". One retry: the mini's resolver drops lookups now and then,
# and a failed lookup makes the Hermes podspec fall back to building from git.
export EX_UPDATES_NATIVE_DEBUG=1
(cd ios && { pod install || pod install; })

workspace=$(ls -d ios/*.xcworkspace | head -1)
scheme=$(basename "$workspace" .xcworkspace)

# Debug native code with the JS bundle embedded, so the app starts without a
# Metro server; with Metro running on the same network it still prefers the
# live bundle. RCT_NO_LAUNCH_PACKAGER keeps Xcode from opening a Terminal
# with Metro on the mini's desktop.
build() {
	local log=$logs/xcodebuild-$1.log status=0
	shift
	echo "xcodebuild ($log)"
	RCT_NO_LAUNCH_PACKAGER=1 xcodebuild -workspace "$workspace" \
		-scheme "$scheme" -configuration Debug -derivedDataPath "$derived" \
		"$@" build >"$log" 2>&1 || status=$?
	scrub "$log"
	if ((status)); then
		grep -E 'error:|BUILD FAILED' "$log" | head -40 >&2
		exit "$status"
	fi
	grep -m1 "BUILD SUCCEEDED" "$log"
}

# xcodebuild echoes its command line; the API key's id, issuer and path
# never stay in a log.
scrub() {
	local v
	for v in "${ASC_KEY_PATH:-}" "${ASC_KEY_ID:-}" "${ASC_ISSUER_ID:-}"; do
		[[ -n "$v" ]] || continue
		sed "s|$v|<redacted>|g" "$1" >"$1.tmp" && mv "$1.tmp" "$1"
	done
}

device_build() {
	# shellcheck source=ios-signing.sh
	source "$app/scripts/ios-signing.sh"
	signing_keychain
	signing_identity
	signing_device "$iphone"
	# The key values live in this subshell only.
	(
		# shellcheck disable=SC1091
		source "$HOME/.appstoreconnect/env"
		build device -destination "id=$iphone" \
			-allowProvisioningUpdates -allowProvisioningDeviceRegistration \
			-authenticationKeyPath "$ASC_KEY_PATH" \
			-authenticationKeyID "$ASC_KEY_ID" \
			-authenticationKeyIssuerID "$ASC_ISSUER_ID"
	)
}

# One attempt each, bounded: a locked phone or an untrusted developer fails
# fast here instead of hanging the run.
device_run() {
	local built=$derived/Build/Products/Debug-iphoneos/$scheme.app
	# devicectl takes the SUDO_* variables from launchctl asuser for a root
	# run and warns that it may misbehave; it runs as the user here.
	local -a dc=(env -u SUDO_USER -u SUDO_UID -u SUDO_GID -u SUDO_COMMAND xcrun devicectl)
	timeout 180 "${dc[@]}" device install app --device "$iphone" "$built"
	timeout 60 "${dc[@]}" device process launch --device "$iphone" \
		--terminate-existing "$bundle_id"
}

# The newest iOS runtime that runs an iPhone 17. Xcode 27.1's iOS 27.1
# runtime only supports iPhone Duo, so today this is iOS 27.0.
sim_runtime() {
	xcrun simctl list runtimes -j | node -e '
		const { runtimes } = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
		const ok = runtimes.filter((r) => r.platform === "iOS" && r.isAvailable &&
			r.supportedDeviceTypes.some((t) => t.identifier === process.argv[1]));
		ok.sort((a, b) => a.version.localeCompare(b.version, "en", { numeric: true }));
		if (!ok.length) process.exit(1);
		const r = ok[ok.length - 1];
		console.log(`${r.identifier} ${r.version}`);
	' "$sim_type"
}

simulator() {
	local runtime version name udid
	read -r runtime version < <(sim_runtime) || true
	[[ -n "$runtime" ]] || { echo "No iOS runtime runs $sim_type" >&2 && exit 1; }
	name="Retrospend iPhone 17 ($version)"
	udid=$(xcrun simctl list devices -j | node -e '
		const { devices } = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
		const d = (devices[process.argv[1]] || []).find((d) => d.name === process.argv[2]);
		if (d) console.log(d.udid);
	' "$runtime" "$name")
	if [[ -z "$udid" ]]; then
		udid=$(xcrun simctl create "$name" "$sim_type" "$runtime")
	fi
	echo "Simulator: $name ($udid)"
	rm -f "$work"/shots/*.png
	build simulator -destination "id=$udid"
	xcrun simctl bootstatus "$udid" -b >/dev/null
	xcrun simctl install "$udid" \
		"$derived/Build/Products/Debug-iphonesimulator/$scheme.app"
	xcrun simctl launch --terminate-running-process "$udid" "$bundle_id"
	# Long enough for the embedded bundle to load and the first screen to
	# draw on a cold boot.
	sleep 15
	xcrun simctl io "$udid" screenshot "$work/shots/iphone17-ios$version.png"
	xcrun simctl shutdown "$udid"
}

# Plain statements, not an && chain: set -e does not apply inside functions
# called from one.
case "$target" in
device)
	device_build
	device_run
	;;
simulator) simulator ;;
all)
	device_build
	simulator
	# The phone goes last: it is the step most likely to need the owner.
	device_run
	;;
*) echo "usage: $0 [device|simulator|all]" >&2 && exit 2 ;;
esac
