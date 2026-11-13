import { describe, expect, it } from "vitest";
import { isCrypto } from "../currency-format";
import { roundMoneyDec } from "../money-dec";
import { Dec, dec } from "../precise-decimal";
import {
	homePerUnit,
	homeValue,
	missingRateOf,
	type RatePick,
	ratePerUnit,
} from "./valuation";

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

/** A rate table of one type per currency, in the stored convention. */
const table =
	(rates: Record<string, number>): RatePick =>
	(currency, date) =>
		rates[currency] === undefined
			? null
			: { rate: rates[currency], type: "official", date, onOrBefore: true };

const worth = (
	rates: Record<string, number>,
	currency: string,
	units: string,
	home: string,
) =>
	homeValue(
		table(rates),
		{ currency, rateType: null, storedRate: null },
		dec(units),
		home,
		DAY,
	);

describe("one division per value", () => {
	// EUR 3 per USD, JPY 16.5 per USD: one EUR is 16.5 / 3 = 5.5 JPY exactly.
	// Two divisions gave (1/3) / (1/16.5) = 5.4999...9, which rounds to 5.
	it("1 EUR at 3 per USD into JPY at 16.5 is exactly 5.5, which rounds to 6", () => {
		const v = worth({ EUR: 3, JPY: 16.5 }, "EUR", "1", "JPY");
		expect(v?.toFixed()).toBe("5.5");
		expect(roundMoneyDec(v ?? 0, "JPY").toFixed()).toBe("6");
	});

	it("3.5 JPY from 1 EUR at 3 per USD into JPY at 10.5 rounds to 4 (half to even)", () => {
		// 10.5 / 3 = 3.5, a tie; 4 is the even neighbor.
		const v = worth({ EUR: 3, JPY: 10.5 }, "EUR", "1", "JPY");
		expect(roundMoneyDec(v ?? 0, "JPY").toFixed()).toBe("4");
	});

	it("a non-tie control: 1 EUR at 3 per USD into JPY at 16.4 is 5.4666... and rounds to 5", () => {
		const v = worth({ EUR: 3, JPY: 16.4 }, "EUR", "1", "JPY");
		expect(roundMoneyDec(v ?? 0, "JPY").toFixed()).toBe("5");
	});

	it("a coin into ARS: 0.01234567 BTC x 60,000 x 1,545 = 1,144,443.609", () => {
		const v = worth({ BTC: 60000, ARS: 1545 }, "BTC", "0.01234567", "ARS");
		expect(v?.toFixed()).toBe("1144443.609");
	});

	it("a coin out of ARS: ARS 92,700,000 / 1,545 / 60,000 = 1 BTC", () => {
		const v = worth({ BTC: 60000, ARS: 1545 }, "ARS", "92700000", "BTC");
		expect(v?.toFixed()).toBe("1");
	});

	it("homePerUnit is a numerator and denominator that divide once", () => {
		const f = homePerUnit(
			table({ EUR: 3, JPY: 16.5 }),
			{ currency: "EUR", rateType: null, storedRate: null },
			"JPY",
			DAY,
		);
		// (1 / 3) / (1 / 16.5) = (1 x 16.5) / (3 x 1).
		expect(f?.map((d) => d.toFixed())).toEqual(["16.5", "3"]);
		expect(f && ratePerUnit(f).toFixed()).toBe("5.5");
	});

	it("names the currency a valuation lacks: the account's first, then the home's", () => {
		const rates = table({ EUR: 3 });
		const eur = { currency: "EUR", rateType: null, storedRate: null };
		const xyz = { currency: "XYZ", rateType: null, storedRate: null };
		expect(missingRateOf(rates, eur, "JPY", DAY)).toBe("JPY");
		expect(missingRateOf(rates, xyz, "JPY", DAY)).toBe("XYZ");
		expect(missingRateOf(rates, eur, "USD", DAY)).toBeNull();
		expect(missingRateOf(rates, xyz, "XYZ", DAY)).toBeNull();
	});
});

/** The valuation before 4c, frozen here: two divisions, 1 / rate then a quotient of quotients. */
function oldPerUnit(
	account: [string, number],
	home: [string, number],
): InstanceType<typeof Dec> {
	const usdPer = ([currency, rate]: [string, number]) =>
		currency === "USD"
			? dec(1)
			: isCrypto(currency)
				? dec(String(rate))
				: dec(1).div(dec(String(rate)));
	return usdPer(account).div(usdPer(home));
}

describe("what a writer stores does not move", () => {
	// A seeded generator, so a failure names its inputs.
	let state = 20261112;
	const next = () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
	const pickOf = <T>(list: T[]) => list[Math.floor(next() * list.length)] as T;

	it("the 8 dp leg value and the 12 dp rate match the old two-division quotient", () => {
		const currencies = ["USD", "ARS", "JPY", "EUR", "BRL", "BTC", "ETH"];
		let compared = 0;
		for (let i = 0; i < 2000; i++) {
			const a = pickOf(currencies);
			const h = pickOf(currencies);
			if (a === h) continue;
			const rates: Record<string, number> = {};
			for (const c of currencies) {
				if (c === "USD") continue;
				// Fiat: up to 4 dp per USD; coins: a USD price with 2 dp.
				rates[c] = isCrypto(c)
					? Math.round((1 + next() * 90000) * 100) / 100
					: Math.round((0.5 + next() * 1600) * 10000) / 10000;
			}
			const units = dec((Math.round(next() * 1e9) / 1e4 - 50000).toFixed(4));
			const f = homePerUnit(
				table(rates),
				{ currency: a, rateType: null, storedRate: null },
				h,
				DAY,
			);
			const old = oldPerUnit([a, rates[a] ?? 1], [h, rates[h] ?? 1]);
			expect(f).not.toBeNull();
			if (!f) continue;
			const now = ratePerUnit(f);
			// The 12 dp rate (v1 accounts items) and the 8 dp leg value (bookHome).
			expect(now.toDecimalPlaces(12, Dec.ROUND_HALF_EVEN).toFixed()).toBe(
				old.toDecimalPlaces(12, Dec.ROUND_HALF_EVEN).toFixed(),
			);
			expect(
				units.mul(now).toDecimalPlaces(8, Dec.ROUND_HALF_EVEN).toFixed(),
			).toBe(units.mul(old).toDecimalPlaces(8, Dec.ROUND_HALF_EVEN).toFixed());
			compared++;
		}
		expect(compared).toBeGreaterThan(1500);
	});
});
