#!/usr/bin/env bash
# Moves the prebuilt iOS project to the UIScene life cycle:
#
#   bash apps/mobile/scripts/ios-scene-lifecycle.sh <ios dir>
#
# Apps built with the iOS 27 SDK refuse to launch without it ("UIScene life
# cycle is required for apps built with this SDK"). Expo SDK 57 ships the
# scene delegate (ExpoAppSceneDelegate, Objective-C name
# EXExpoAppSceneDelegate) but its prebuild template still starts React Native
# from the app delegate. This does what the SDK 58 template does: the app
# delegate only creates the React Native factory, and the scene delegate
# makes the window and starts React Native in it.
#
# It belongs in a config plugin (apps/mobile/plugins); it lives here until
# one exists or the app moves to SDK 58. Safe to run twice, and a no-op once
# the template has a scene manifest of its own.
set -euo pipefail

ios=${1:?usage: $0 <ios dir>}
projects=("$ios"/*.xcodeproj)
plist=$ios/$(basename "${projects[0]}" .xcodeproj)/Info.plist
delegate=$(dirname "$plist")/AppDelegate.swift
pb=/usr/libexec/PlistBuddy

if "$pb" -c "Print :UIApplicationSceneManifest" "$plist" >/dev/null 2>&1; then
	exit 0
fi

node - "$delegate" <<'EOF'
const fs = require("node:fs");
const file = process.argv[2];
let src = fs.readFileSync(file, "utf8");
const header = "class AppDelegate: ExpoAppDelegate {";
// The block that makes a screen-sized window and starts React Native in it.
const start = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)[\s\S]*?#endif\n/;
if (!src.includes(header) || !start.test(src)) {
	console.error(`${file} no longer matches the SDK 57 template; update ios-scene-lifecycle.sh`);
	process.exit(1);
}
src = src
	.replace(header, "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {")
	.replace(start, "\n    // The scene delegate (EXExpoAppSceneDelegate) makes the window and starts React Native.\n");
fs.writeFileSync(file, src);
EOF

role=:UIApplicationSceneManifest:UISceneConfigurations:UIWindowSceneSessionRoleApplication
"$pb" \
	-c "Add :UIApplicationSceneManifest dict" \
	-c "Add :UIApplicationSceneManifest:UIApplicationSupportsMultipleScenes bool false" \
	-c "Add :UIApplicationSceneManifest:UISceneConfigurations dict" \
	-c "Add $role array" \
	-c "Add $role:0 dict" \
	-c "Add $role:0:UISceneConfigurationName string Default Configuration" \
	-c "Add $role:0:UISceneDelegateClassName string EXExpoAppSceneDelegate" \
	"$plist"
echo "Scene life cycle: $delegate, $plist"
