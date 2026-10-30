import { screenKey } from "./ScreenTracker";

describe("screenKey", () => {
	it("names tab pages without the route group", () => {
		expect(screenKey("/(tabs)/home")).toBe("home");
		expect(screenKey("/(tabs)/activity")).toBe("activity");
		expect(screenKey("/(tabs)/home/insights")).toBe("insights");
	});

	it("names pages with an id by their template, never the id", () => {
		expect(screenKey("/(tabs)/activity/[id]")).toBe("entry");
		expect(screenKey("/(tabs)/people/[type]/[id]")).toBe("person");
		expect(screenKey("/(tabs)/people/project/[id]")).toBe("project");
		expect(screenKey("/(tabs)/wealth/[id]")).toBe("account");
	});

	it("names settings pages, and treats every admin page as Admin", () => {
		expect(screenKey("/settings")).toBe("settings");
		expect(screenKey("/settings/payment-methods")).toBe("paymentMethods");
		expect(screenKey("/settings/admin-users")).toBe("admin");
	});

	it("falls back to the root as Home and to Other for the unknown", () => {
		expect(screenKey("/")).toBe("home");
		expect(screenKey(undefined)).toBe("home");
		expect(screenKey("/something/new?x=1")).toBe("other");
	});
});
