import { accountHref, wealthBaseOf } from "./routes";

describe("wealth routes", () => {
	it("reads the Wealth root a screen is inside", () => {
		expect(wealthBaseOf("/home/wealth")).toBe("/home/wealth");
		expect(wealthBaseOf("/home/wealth/acc_1")).toBe("/home/wealth");
		expect(wealthBaseOf("/budget/wealth")).toBe("/budget/wealth");
		expect(wealthBaseOf("/budget/wealth/acc_1")).toBe("/budget/wealth");
		expect(wealthBaseOf("/wealth/acc_1")).toBe("/wealth");
	});

	it("opens an account in the stack that is showing Wealth, so back leaves it", () => {
		expect(accountHref("/home/wealth", "acc_1")).toBe("/home/wealth/acc_1");
		expect(accountHref("/budget/wealth", "acc_1")).toBe("/budget/wealth/acc_1");
		expect(accountHref("/wealth", "acc_1")).toBe("/wealth/acc_1");
	});
});
