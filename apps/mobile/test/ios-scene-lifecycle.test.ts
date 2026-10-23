/**
 * @jest-environment node
 */
import config from "../app.config";

const {
	adoptSceneDelegate,
	addSceneManifest,
} = require("../plugins/with-ios-scene-lifecycle");

// The window setup of Expo SDK 57's AppDelegate.swift template.
const SDK57 = `@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

// SDK 58's template already uses scenes.
const SDK58 = `@main
class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {
  var window: UIWindow?
}
`;

describe("iOS scene life cycle plugin", () => {
	it("is registered", () => {
		expect(config.plugins).toContain("./plugins/with-ios-scene-lifecycle");
	});

	it("leaves the window and React Native start to the scene delegate", () => {
		const out = adoptSceneDelegate(SDK57);
		expect(out).toContain(
			"class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {",
		);
		expect(out).not.toContain("UIWindow(frame:");
		expect(out).not.toContain("startReactNative");
		expect(out).toContain("reactNativeFactory = factory");
		expect(adoptSceneDelegate(out)).toBe(out);
	});

	it("leaves a scene-based template alone", () => {
		expect(adoptSceneDelegate(SDK58)).toBe(SDK58);
	});

	it("fails on a template it does not know", () => {
		expect(() => adoptSceneDelegate("class AppDelegate: Other {}")).toThrow(
			/no longer matches/,
		);
	});

	it("points the scene manifest at Expo's scene delegate", () => {
		const plist = addSceneManifest({ CFBundleName: "Retrospend" });
		expect(plist.CFBundleName).toBe("Retrospend");
		expect(plist.UIApplicationSceneManifest).toEqual({
			UIApplicationSupportsMultipleScenes: false,
			UISceneConfigurations: {
				UIWindowSceneSessionRoleApplication: [
					{
						UISceneConfigurationName: "Default Configuration",
						UISceneDelegateClassName: "EXExpoAppSceneDelegate",
					},
				],
			},
		});
	});

	it("keeps a manifest the template already has", () => {
		const own = { UIApplicationSceneManifest: { kept: true } };
		expect(addSceneManifest(own)).toBe(own);
	});
});
