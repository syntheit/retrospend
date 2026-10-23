import { describe, expect, it } from "vitest";
import { dec } from "~/server/services/envelope/units";
import { homePerUnit, homeValue, type RatePick } from "./valuation";

const DAY = new Date("2026-10-21T23:59:59.999Z");

/** ARS: Blue 1,468, Official 1,412, MEP 1,449 per USD; BTC USD 60,000; BRL Official 5.4. */
const RATES: Record<string, Record<string, number>> = {
	ARS: { blue: 1468, official: 1412, mep: 1449 },
	BTC: { crypto: 60000 },
	BRL: { official: 5.4 },
};
const DEFAULT_ORDER = ["blue", "official", "crypto"];
const pick: RatePick = (currency, date, preferred) => {
	const types = RATES[currency];
	if (!types) return null;
	const type =
		preferred && types[preferred] !== undefined
			? preferred
			: DEFAULT_ORDER.find((t) => types[t] !== undefined);
	return type ? { rate: types[type] ?? 0, type, date, onOrBefore: true } : null;
};

const value = (
	currency: string,
	rateType: string | null,
	units: string,
	home: string,
	storedRate: number | null = null,
) =>
	homeValue(
		pick,
		{ currency, rateType, storedRate },
		dec(units),
		home,
		DAY,
	)?.toFixed(2) ?? null;

describe("account valuation", () => {
	it("home money is worth itself", () => {
		expect(value("ARS", "blue", "1000000", "ARS")).toBe("1000000.00");
	});

	it("a USD account converts through the home default pick (today's rule)", () => {
		expect(value("USD", null, "1840.55", "ARS")).toBe("2701927.40");
	});

	it("a USD account valued at Official uses the home Official rate (D3)", () => {
		expect(value("USD", "official", "2000", "ARS")).toBe("2824000.00");
	});

	it("an ARS account's type picks the ARS rate for a USD home", () => {
		expect(value("ARS", "official", "1412000", "USD")).toBe("1000.00");
		expect(value("ARS", "blue", "1468000", "USD")).toBe("1000.00");
	});

	it("crypto multiplies by the USD price", () => {
		expect(value("BTC", null, "0.5", "USD")).toBe("30000.00");
		expect(value("BTC", null, "0.01", "ARS")).toBe("880800.00");
	});

	it("a custom type uses the stored rate as typed", () => {
		expect(value("ARS", "custom", "2000000", "USD", 2000)).toBe("1000.00");
	});

	it("no table rate falls back to the stored rate, and none is unavailable", () => {
		expect(value("CLP", null, "950", "USD", 950)).toBe("1.00");
		expect(value("CLP", null, "950", "USD")).toBeNull();
		expect(
			homePerUnit(
				pick,
				{ currency: "USD", rateType: null, storedRate: null },
				"CLP",
				DAY,
			),
		).toBeNull();
	});

	it("negative balances convert like any other", () => {
		expect(value("USD", null, "-100", "ARS")).toBe("-146800.00");
	});
});
