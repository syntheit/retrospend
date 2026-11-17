// Runs the golden create-body vectors (expense-input.vectors.json) through the mapping.
import { describe, expect, it } from "vitest";
import { toBookingInput } from "../src/expense-input";
import vectors from "./expense-input.vectors.json";

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
