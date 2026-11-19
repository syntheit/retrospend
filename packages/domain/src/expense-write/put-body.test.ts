import { describe, expect, it } from "vitest";
import { toBookingInput } from "../expense-input";
import { editExpense } from "./edit";
import { arsRow, fakePort } from "./fake-port";
import { ENTRY_POLICY } from "./policy";
import { putBodyOf, rateInputOf } from "./put-body";
import { SPREAD_NOT_ON_DEVICE } from "./refusals";

const BA = "America/Argentina/Buenos_Aires";

/** USD 100 at a typed blue-ish rate of 1,600: home ARS 160,000.00. */
const custom = {
	...arsRow,
	rateType: "custom",
	homeRate: "1600",
	homeAmount: "160000.00",
	date: new Date("2026-03-05T02:00:00Z"),
};

describe("putBodyOf", () => {
	it("ARS custom blue rate re-base keeps customRate and home amount", async () => {
		const body = putBodyOf(custom, BA);
		expect(body.customRate).toBe("1600");
		expect(body.rateType).toBeUndefined();
		// The server reads the body through toBookingInput and edits the row: a
		// rebook at the table's blue 1545 would give 154500.00.
		const p = fakePort(custom);
		await editExpense(
			p.port,
			{ ...toBookingInput(body, BA), id: "e1" },
			ENTRY_POLICY,
		);
		expect(p.written[0]).toMatchObject({
			homeRate: "1600",
			homeAmount: "160000.00",
		});
	});

	it("day is dayKey in the send's zone", () => {
		// 02:00Z is 23:00 the day before at UTC-3.
		expect(putBodyOf(custom, BA).date).toBe("2026-03-04");
		expect(putBodyOf(custom, "UTC").date).toBe("2026-03-05");
		expect(toBookingInput(putBodyOf(custom, BA), BA).date.toISOString()).toBe(
			"2026-03-04T03:00:00.000Z",
		);
	});

	it("sends every stored digit of the amount as plain text", () => {
		expect(putBodyOf({ ...arsRow, amount: "0.00000001" }, "UTC").amount).toBe(
			"0.00000001",
		);
		expect(putBodyOf({ ...arsRow, amount: "100.00000000" }, "UTC").amount).toBe(
			"100",
		);
	});

	it("a table rate stays its type; a null category, location and note are left out", () => {
		expect(putBodyOf(arsRow, "UTC")).toEqual({
			title: "Lunch",
			amount: "100",
			currency: "USD",
			date: "2026-03-05",
			categoryId: "c-old",
			rateType: "blue",
			excludeFromAnalytics: false,
		});
		const bare = putBodyOf(
			{
				...arsRow,
				rateType: null,
				categoryId: null,
				location: "x",
				description: "y",
			},
			"UTC",
		);
		expect(bare).toMatchObject({ location: "x", description: "y" });
		expect(bare).not.toHaveProperty("categoryId");
		expect(bare).not.toHaveProperty("rateType");
	});

	it("a spread parent has no body: PUT without amortizeOver would remove its parts", () => {
		expect(() =>
			putBodyOf({ ...arsRow, isAmortizedParent: true }, "UTC"),
		).toThrow(SPREAD_NOT_ON_DEVICE);
	});
});

describe("rateInputOf", () => {
	it("a custom rate comes back as the same cross rate with its home, every digit", () => {
		expect(
			rateInputOf({
				...custom,
				homeRate: { toString: () => "1.5e-7" },
			}),
		).toEqual({
			customRate: { base: "USD", value: "0.00000015", home: "ARS" },
		});
	});

	it("a table rate comes back as both legs: the entry rate, its source and its type", () => {
		expect(rateInputOf(arsRow)).toEqual({
			exchangeRate: 1,
			pricingSource: "MANUAL",
			rateType: "blue",
		});
		expect(
			rateInputOf({ ...arsRow, pricingSource: null, rateType: null }),
		).toEqual({
			exchangeRate: 1,
		});
	});

	it("a custom row without a home rate falls back to its saved legs", () => {
		expect(rateInputOf({ ...custom, homeRate: null })).toMatchObject({
			rateType: "custom",
		});
	});
});
