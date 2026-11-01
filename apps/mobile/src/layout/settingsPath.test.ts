import { isAccountPath, settingsHref } from "./settingsPath";

jest.mock("expo-router", () => ({ router: {}, usePathname: () => "/" }));

describe("settings page routes", () => {
	it("stays inside the account sheet when opened from it", () => {
		expect(settingsHref("profile", true)).toBe("/account/profile");
		expect(settingsHref("settings", true)).toBe("/account/settings");
	});

	it("pushes over the tabs otherwise", () => {
		expect(settingsHref("profile", false)).toBe("/settings/profile");
		expect(settingsHref("settings", false)).toBe("/settings");
	});

	it("knows the account sheet by its path", () => {
		expect(isAccountPath("/account")).toBe(true);
		expect(isAccountPath("/account/profile")).toBe(true);
		expect(isAccountPath("/accounting")).toBe(false);
		expect(isAccountPath("/settings/profile")).toBe(false);
	});
});
