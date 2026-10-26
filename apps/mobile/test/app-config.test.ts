/**
 * @jest-environment node
 */
import config, { assertBuildProfile } from "../app.config";

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

	it("keeps the agreed identity", () => {
		expect(config.ios?.bundleIdentifier).toBe("app.retrospend");
		expect(config.android?.package).toBe("app.retrospend");
		expect(config.scheme).toBe("retrospend");
		expect(config.android?.predictiveBackGestureEnabled).toBe(false);
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
