import { accountHref, wealthBaseOf, wealthHref } from "./routes";

describe("wealth routes", () => {
	it("opens Wealth as its own tab from Home and from Budget", () => {
		expect(wealthHref("home")).toBe("/wealth");
		expect(wealthHref("budget")).toBe("/wealth");
	});

	it("opens an account inside the Wealth stack, so back returns to the list", () => {
		expect(wealthBaseOf("/wealth/acc_1")).toBe("/wealth");
		expect(accountHref("/wealth", "acc_1")).toBe("/wealth/acc_1");
	});
});
