/**
 * The envelope pure core lives in @retrospend/domain; these paths re-export
 * it. Parity: the server sees the very same functions, and values that come
 * out of Postgres as Prisma Decimals give the same minor units as the same
 * digits as strings (the device sees strings).
 */
import * as domainEngine from "@retrospend/domain/envelope/engine";
import * as domainUnits from "@retrospend/domain/envelope/units";
import { describe, expect, it } from "vitest";
import { Prisma } from "~prisma";
import * as engine from "./engine";
import * as units from "./units";

describe("server paths re-export the domain envelope core", () => {
	it("is one function, not a copy", () => {
		expect(engine.computeBook).toBe(domainEngine.computeBook);
		expect(units.toMinor).toBe(domainUnits.toMinor);
		expect(units.mulDiv).toBe(domainUnits.mulDiv);
	});
});

describe("toMinor on Prisma Decimals and strings (hand-derived)", () => {
	const cases = [
		// ARS has 2 decimals: 12345.675 x 100 = 1234567.5, half-even to the even 1234568.
		{ amount: "12345.675", currency: "ARS", minor: 1_234_568 },
		// 12345.665 x 100 = 1234566.5, half-even to the even 1234566.
		{ amount: "12345.665", currency: "ARS", minor: 1_234_566 },
		// JPY has 0 decimals: 1000.5 is a tie, half-even gives 1000.
		{ amount: "1000.5", currency: "JPY", minor: 1000 },
		// KWD has 3 decimals: 1234.5678 x 1000 = 1234567.8 rounds to 1234568.
		{ amount: "1234.5678", currency: "KWD", minor: 1_234_568 },
		// Decimal(19,8) at its top: 99999999999.99999999 USD x 100 = 9999999999999.999999 -> 10^13.
		{
			amount: "99999999999.99999999",
			currency: "USD",
			minor: 10_000_000_000_000,
		},
	];
	for (const c of cases) {
		it(`${c.amount} ${c.currency}`, () => {
			expect(units.toMinor(c.amount, c.currency)).toBe(c.minor);
			expect(units.toMinor(new Prisma.Decimal(c.amount), c.currency)).toBe(
				c.minor,
			);
		});
	}
});
