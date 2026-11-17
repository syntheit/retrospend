import { describe, expect, it } from "vitest";
import vectors from "../vectors/expense-input.vectors.json";
import { toBookingInput } from "./expense-input";

describe("toBookingInput over the golden vectors", () => {
	for (const c of vectors.cases) {
		for (const [zone, instant] of Object.entries(c.instants)) {
			it(`${c.name}, request zone ${zone}`, () => {
				const out = toBookingInput(c.body, zone);
				expect(out.date.toISOString()).toBe(instant);
				expect(out.amount).toBe(c.body.amount);
				expect(out.currency).toBe(c.body.currency);
				if ("customRate" in c.body)
					expect(out.customRate).toEqual({
						base: c.body.currency,
						value: c.body.customRate,
					});
				else expect(out.customRate).toBeUndefined();
				if ("rateType" in c.body) expect(out.rateType).toBe(c.body.rateType);
				else expect(out.rateType).toBeUndefined();
			});
		}
	}
});

describe("toBookingInput", () => {
	const body = {
		title: "Lunch",
		amount: "12",
		currency: "EUR",
		date: "2026-04-01",
	};

	it("a typed rate wins over a rate type, quoted for the expense's own currency", () => {
		const out = toBookingInput(
			{ ...body, rateType: "official", customRate: "1500" },
			"UTC",
		);
		expect(out.customRate).toEqual({ base: "EUR", value: "1500" });
		expect("rateType" in out).toBe(false);
	});

	it("an empty typed rate falls back to the rate type", () => {
		const out = toBookingInput(
			{ ...body, rateType: "blue", customRate: "" },
			"UTC",
		);
		expect(out.rateType).toBe("blue");
		expect("customRate" in out).toBe(false);
	});

	it("with neither, no rate key is set and the other fields pass through", () => {
		const out = toBookingInput({ ...body, id: "x1", categoryId: "c1" }, "UTC");
		expect(out).toEqual({
			title: "Lunch",
			amount: "12",
			currency: "EUR",
			id: "x1",
			categoryId: "c1",
			date: new Date("2026-04-01T00:00:00.000Z"),
		});
	});

	it("refuses a day that is not YYYY-MM-DD", () => {
		expect(() => toBookingInput({ ...body, date: "04/01/2026" }, "UTC")).toThrow(
			"Date must be in YYYY-MM-DD format",
		);
	});
});
