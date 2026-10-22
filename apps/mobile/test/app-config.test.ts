/**
 * @jest-environment node
 */
import config from "../app.config";

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
		expect(config.android?.predictiveBackGestureEnabled).toBe(true);
	});
});
