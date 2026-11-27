import { describe, expect, it } from "vitest";
import { accountColumnsOf } from "./columns";

const base = {
	name: "Visa",
	type: "LIABILITY_CREDIT_CARD",
	currency: "ARS",
	isLiquid: false,
};

describe("accountColumnsOf", () => {
	it("writes the rate at 6 decimals and the payment at 8, half to even", () => {
		expect(
			accountColumnsOf({
				...base,
				interestRate: "24.5",
				minimumPayment: "100.123456785",
			}),
		).toMatchObject({ interestRate: "24.5", minimumPayment: "100.12345678" });
		// 6 decimals: 0.0000005 is a tie, and the even neighbour is 0.
		expect(
			accountColumnsOf({ ...base, interestRate: "1.0000005" }).interestRate,
		).toBe("1");
		expect(
			accountColumnsOf({ ...base, interestRate: "1.0000015" }).interestRate,
		).toBe("1.000002");
	});

	it("keeps null as null and leaves undefined alone", () => {
		const columns = accountColumnsOf({
			...base,
			interestRate: null,
			dueDate: null,
		});
		expect(columns).toMatchObject({ interestRate: null, dueDate: null });
		expect(columns.minimumPayment).toBeUndefined();
	});

	it("leaves the budget column out unless it is named, and names null as the default", () => {
		expect("inBudget" in accountColumnsOf(base)).toBe(false);
		expect(accountColumnsOf({ ...base, inBudget: null }).inBudget).toBeNull();
		expect(accountColumnsOf({ ...base, inBudget: true }).inBudget).toBe(true);
	});

	it("keeps the type it is given", () => {
		expect(accountColumnsOf({ ...base, type: "CASH" as const }).type).toBe(
			"CASH",
		);
	});
});
