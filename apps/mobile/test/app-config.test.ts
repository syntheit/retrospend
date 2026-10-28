/**
 * @jest-environment node
 */

import config, {
	apnsEnvironment,
	assertBuildProfile,
	defaultServer,
} from "../app.config";
import { APP_LOCALES } from "../src/lib/locales";

// Owner decision (2026-10-22): plain http servers are allowed after a
// warning, so release builds must not block them at the OS level.
describe("app config", () => {
	it("lets iOS release builds reach http servers", () => {
		expect(config.ios?.infoPlist?.NSAppTransportSecurity).toEqual({
			NSAllowsArbitraryLoads: true,
		});
	});

	it("adds the Android network security config", () => {
		expect(config.plugins).toContain("./plugins/with-cleartext-servers");
	});

	it("leaves the connect address empty unless the build names a server", () => {
		expect(defaultServer({})).toBe("");
		expect(defaultServer({ RETROSPEND_DEFAULT_SERVER: " " })).toBe("");
		expect(
			defaultServer({
				RETROSPEND_DEFAULT_SERVER: "https://dev.retrospend.app",
			}),
		).toBe("https://dev.retrospend.app");
		expect(config.extra).toHaveProperty("defaultServer");
	});

	it("uses the production APNs host unless an Xcode debug build says otherwise", () => {
		// TestFlight and App Store builds set nothing: production tokens must
		// register with apnsSandbox false.
		expect(apnsEnvironment({})).toBe("production");
		expect(apnsEnvironment({ RETROSPEND_APNS_ENV: "" })).toBe("production");
		expect(apnsEnvironment({ RETROSPEND_APNS_ENV: "sandbox" })).toBe(
			"production",
		);
		expect(apnsEnvironment({ RETROSPEND_APNS_ENV: "development" })).toBe(
			"development",
		);
		expect(config.extra?.apnsSandbox).toBe(false);
		expect(config.plugins).toContainEqual([
			"./plugins/with-ios-push",
			{ mode: "production" },
		]);
	});

	it("keeps the agreed identity", () => {
		expect(config.ios?.bundleIdentifier).toBe("app.retrospend");
		expect(config.android?.package).toBe("app.retrospend");
		expect(config.scheme).toBe("retrospend");
		expect(config.android?.predictiveBackGestureEnabled).toBe(false);
	});

	it("ties the iOS app to both server domains for Password AutoFill", () => {
		expect(config.ios?.associatedDomains).toEqual([
			"webcredentials:dev.retrospend.app",
			"webcredentials:retrospend.app",
		]);
	});

	it("tells Android and iOS which languages the app speaks", () => {
		const entry = config.plugins?.find(
			(p) => Array.isArray(p) && p[0] === "expo-localization",
		) as [string, { supportedLocales: string[] }] | undefined;
		expect(entry?.[1].supportedLocales).toEqual([...APP_LOCALES]);
		expect(entry?.[1].supportedLocales).toContain("es-AR");
	});

	describe("assertBuildProfile", () => {
		it("allows a release build with no dev variables", () => {
			expect(() =>
				assertBuildProfile({ EXPO_PUBLIC_OTHER: "x" }),
			).not.toThrow();
		});

		it.each([
			{ EXPO_PUBLIC_DEV_PASSWORD: "secret" },
			{ EXPO_PUBLIC_DEV_SERVER: "http://x" },
			{ EXPO_PUBLIC_GALLERY: "1" },
		])("refuses %j in a release build", (env) => {
			expect(() => assertBuildProfile(env)).toThrow(/release build/);
			expect(() =>
				assertBuildProfile({ ...env, RETROSPEND_BUILD_PROFILE: "release" }),
			).toThrow();
		});

		it.each(["development", "simulator"])("allows them for %s", (profile) => {
			expect(() =>
				assertBuildProfile({
					EXPO_PUBLIC_DEV_PASSWORD: "secret",
					EXPO_PUBLIC_GALLERY: "1",
					RETROSPEND_BUILD_PROFILE: profile,
				}),
			).not.toThrow();
		});
	});
});
