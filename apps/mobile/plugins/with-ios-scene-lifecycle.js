// Moves the iOS app to the UIScene life cycle. Apps built with the iOS 27
// SDK refuse to launch without it ("UIScene life cycle is required for apps
// built with this SDK"). Expo SDK 57 ships the scene delegate
// (ExpoAppSceneDelegate, Objective-C name EXExpoAppSceneDelegate), but its
// prebuild template still starts React Native from the app delegate. This
// does what the SDK 58 template does: the app delegate only creates the
// React Native factory, and the scene delegate makes the window and starts
// React Native in it. A template that already uses scenes is left alone, so
// an SDK bump needs nothing here.
const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

const SCENE_DELEGATE = "EXExpoAppSceneDelegate";
const HEADER = "class AppDelegate: ExpoAppDelegate {";
const PROVIDER =
	"class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {";
// The SDK 57 block that makes a screen-sized window and starts React Native.
const WINDOW_BLOCK =
	/\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)[\s\S]*?#endif\n/;

function adoptSceneDelegate(src) {
	if (src.includes("ExpoReactNativeFactoryProvider")) return src;
	if (!src.includes(HEADER) || !WINDOW_BLOCK.test(src)) {
		throw new Error(
			"AppDelegate.swift no longer matches the Expo SDK 57 template; update plugins/with-ios-scene-lifecycle.js",
		);
	}
	return src
		.replace(HEADER, PROVIDER)
		.replace(
			WINDOW_BLOCK,
			`\n    // The scene delegate (${SCENE_DELEGATE}) makes the window and starts React Native.\n`,
		);
}

function addSceneManifest(plist) {
	if (plist.UIApplicationSceneManifest) return plist;
	return {
		...plist,
		UIApplicationSceneManifest: {
			UIApplicationSupportsMultipleScenes: false,
			UISceneConfigurations: {
				UIWindowSceneSessionRoleApplication: [
					{
						UISceneConfigurationName: "Default Configuration",
						UISceneDelegateClassName: SCENE_DELEGATE,
					},
				],
			},
		},
	};
}

function withIosSceneLifecycle(config) {
	const withDelegate = withAppDelegate(config, (mod) => {
		if (mod.modResults.language !== "swift") {
			throw new Error("Expected a Swift AppDelegate");
		}
		mod.modResults.contents = adoptSceneDelegate(mod.modResults.contents);
		return mod;
	});
	return withInfoPlist(withDelegate, (mod) => {
		mod.modResults = addSceneManifest(mod.modResults);
		return mod;
	});
}

module.exports = withIosSceneLifecycle;
module.exports.adoptSceneDelegate = adoptSceneDelegate;
module.exports.addSceneManifest = addSceneManifest;
