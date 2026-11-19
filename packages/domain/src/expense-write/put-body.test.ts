import { describe, expect, it } from "vitest";
import { toBookingInput } from "../expense-input";
import { editExpense } from "./edit";
import { arsRow, fakePort, table } from "./fake-port";
import { ENTRY_POLICY } from "./policy";
import { putBodyOf, rateInputOf } from "./put-body";
import {
	EditRefusal,
	otherHomeMessage,
	SPREAD_NOT_ON_DEVICE,
} from "./refusals";

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
		// EUR 100 typed at 1,800 ARS: home ARS 180,000.00 (111.11 USD at the
		// official 0.9 EUR per USD of the day it was booked).
		const eur = {
			...arsRow,
			currency: "EUR",
			exchangeRate: "0.9",
			amountInUSD: "111.11",
			rateType: "custom",
			homeRate: "1800",
			homeAmount: "180000.00",
		};
		const body = putBodyOf(eur, BA, "ARS");
		expect(body.customRate).toBe("1800");
		expect(body.rateType).toBeUndefined();
		// This phone's changed amount (120) is laid over; the server books it.
		// The typed rate crosses through the table's blue 1545: 1545 / 1800 =
		// 0.858333 EUR per USD, and 216000 / 1545 = 139.81 USD. Without the
		// typed rate the saved entry leg stays (0.9, 133.33 USD).
		const p = fakePort(eur, {
			book: table(
				{
					ARS: { rate: 1545, type: "blue" },
					EUR: { rate: 0.9, type: "official" },
				},
				"ARS",
				"blue",
			),
		});
		await editExpense(
			p.port,
			{ ...toBookingInput({ ...body, amount: "120" }, BA), id: "e1" },
			ENTRY_POLICY,
		);
		expect(p.written[0]).toMatchObject({
			rateType: "custom",
			homeRate: "1800",
			homeAmount: "216000.00",
			exchangeRate: "0.858333",
			amountInUSD: "139.81",
		});
	});

	it("a typed rate is refused once the home changed: it would read as a rate into the new home", () => {
		// ARS-home row at custom 1600, home switched to EUR: sent as it is it
		// would book 1,600 EUR per USD.
		expect(() => putBodyOf(custom, BA, "EUR")).toThrow(otherHomeMessage("ARS"));
		expect(() => putBodyOf(custom, BA, "EUR")).toThrow(EditRefusal);
		// A table rate has no home pinned: it books again in the new home.
		expect(putBodyOf(arsRow, BA, "EUR").rateType).toBe("blue");
	});

	it("day is dayKey in the send's zone", () => {
		// 02:00Z is 23:00 the day before at UTC-3.
		expect(putBodyOf(custom, BA, "ARS").date).toBe("2026-03-04");
		expect(putBodyOf(custom, "UTC", "ARS").date).toBe("2026-03-05");
		expect(
			toBookingInput(putBodyOf(custom, BA, "ARS"), BA).date.toISOString(),
		).toBe("2026-03-04T03:00:00.000Z");
	});

	it("sends every stored digit of the amount as plain text", () => {
		expect(
			putBodyOf({ ...arsRow, amount: "0.00000001" }, "UTC", "ARS").amount,
		).toBe("0.00000001");
		expect(
			putBodyOf({ ...arsRow, amount: "100.00000000" }, "UTC", "ARS").amount,
		).toBe("100");
	});

	it("a table rate stays its type; a null category, location and note are left out", () => {
		expect(putBodyOf(arsRow, "UTC", "ARS")).toEqual({
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
			"ARS",
		);
		expect(bare).toMatchObject({ location: "x", description: "y" });
		expect(bare).not.toHaveProperty("categoryId");
		expect(bare).not.toHaveProperty("rateType");
	});

	it("a spread parent has no body: PUT without amortizeOver would remove its parts", () => {
		expect(() =>
			putBodyOf({ ...arsRow, isAmortizedParent: true }, "UTC", "ARS"),
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
