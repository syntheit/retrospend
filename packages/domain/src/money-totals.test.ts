// Totals in exact decimals (sumInDec, missingRatesIn). Every
// expected value is derived by hand in its comment, never copied from the
// code's output. Rates follow the stored convention: fiat in units per USD,
// crypto in USD per coin.
import { describe, expect, it } from "vitest";
import {
	MissingRateError,
	type MoneyItemDec,
	missingRatesIn,
	sumInDec,
} from "./money-dec";
import { roundedMinor } from "./money-minor";
import { dec } from "./precise-decimal";
import { priceShare } from "./spent";

const item = (
	amount: string,
	currency: string,
	usd: string | null,
	booked?: { currency: string; amount: string },
): MoneyItemDec => ({
	amount: dec(amount),
	currency,
	amountInUSD: usd === null ? null : dec(usd),
	booked: booked
		? { currency: booked.currency, amount: dec(booked.amount) }
		: null,
});

const fixed = (d: { toFixed(): string }) => d.toFixed();

describe("sumInDec", () => {
	const items = [
		item("100000", "ARS", "100"),
		item("20", "USD", "20"),
		item("10", "EUR", "11.38"),
		item("0.001", "BTC", "64.55"),
	];

	it("ARS home: ARS as entered, the rest from USD at the home rate", () => {
		// USD of the rest: 20 + 11.38 + 64.55 = 95.93; x 1560 = 149650.8
		// (95 x 1560 = 148200, 0.93 x 1560 = 1450.8); plus 100000 as entered.
		expect(fixed(sumInDec(items, "ARS", 1560))).toBe("249650.8");
	});

	it("USD home: USD as entered, the rest from their stored USD", () => {
		// ARS row counts its 100 USD: 100 + 20 + 11.38 + 64.55 = 195.93
		expect(fixed(sumInDec(items, "USD", 1))).toBe("195.93");
	});

	it("EUR, JPY and crypto homes use their own rate", () => {
		// EUR: 10 as entered; USD of the rest 100 + 20 + 64.55 = 184.55 x 0.8787
		// = 147.64 + 12.9185 + 1.4764 + 0.129185 = 162.164085; total 172.164085.
		expect(fixed(sumInDec(items, "EUR", 0.8787))).toBe("172.164085");
		// JPY: 195.93 x 163.83 = 31348.8 + 587.79 + 156.744 + 5.8779 = 32099.2119
		expect(fixed(sumInDec(items, "JPY", 163.83))).toBe("32099.2119");
		// BTC at 50000 USD per coin: 0.001 as entered; (100 + 20 + 11.38) / 50000
		// = 131.38 / 50000 = 0.0026276; total 0.0036276.
		expect(fixed(sumInDec(items, "BTC", 50_000))).toBe("0.0036276");
	});

	it("a sum of 1000 Decimal(19,8) values is exact", () => {
		// 99999999999.99999999 x 1000 moves the point three places:
		// 99999999999999.99999 (a float or a 20 digit Decimal loses it).
		const big = Array.from({ length: 1000 }, () =>
			item("99999999999.99999999", "ARS", null),
		);
		expect(fixed(sumInDec(big, "ARS", null))).toBe("99999999999999.99999");
		// 1000 x 0.1 is 100, where float addition gives 99.9999999999986.
		const tenths = Array.from({ length: 1000 }, () =>
			item("0.1", "USD", "0.1"),
		);
		expect(fixed(sumInDec(tenths, "USD", 1))).toBe("100");
	});

	it("an ARS-home month with booked and unbooked rows (1 USD = 1545)", () => {
		const month = [
			item("15450", "ARS", "10"), // in the home currency: as entered
			item("20", "USD", "20", { currency: "ARS", amount: "30000" }), // booked at 1500
			item("10.01", "USD", "10.01"), // unbooked: period rate
			item("5", "EUR", "5.5"), // unbooked: period rate
			item("-3", "USD", "-3"), // a refund nets
		];
		// Own and booked: 15450 + 30000 = 45450. USD of the rest:
		// 10.01 + 5.5 - 3 = 12.51; x 1545 = 18540 + 787.95 = 19327.95.
		// Total 64777.95 ARS, which is 6477795 minor units (2 decimals).
		const total = sumInDec(month, "ARS", 1545);
		expect(fixed(total)).toBe("64777.95");
		expect(roundedMinor(total, "ARS")).toBe(6_477_795);
	});

	it("an item booked in the total's currency counts its booked value, whatever the rate (M2)", () => {
		const booked = item("20", "USD", "20", {
			currency: "ARS",
			amount: "24000",
		});
		const legacy = item("5", "USD", "5");
		expect(fixed(sumInDec([booked], "ARS", 1300))).toBe("24000");
		expect(fixed(sumInDec([booked], "ARS", undefined))).toBe("24000");
		expect(fixed(sumInDec([booked], "USD", 1))).toBe("20");
		// A row with no booked value keeps the period rate: 5 x 1300.
		expect(fixed(sumInDec([booked, legacy], "ARS", 1300))).toBe("30500");
	});

	it("a missing rate throws only when something needs converting, never counts as 1", () => {
		expect(() => sumInDec(items, "ARS", undefined)).toThrow(MissingRateError);
		expect(() => sumInDec(items, "ARS", 0)).toThrow(MissingRateError);
		expect(() => sumInDec([item("100", "USD", "100")], "EUR", null)).toThrow(
			MissingRateError,
		);
		// The ARS row alone is already in ARS: no rate needed.
		expect(fixed(sumInDec([items[0] as MoneyItemDec], "ARS", undefined))).toBe(
			"100000",
		);
	});

	it("an unpriced item counts only in its own currency", () => {
		const isk = item("900", "ISK", null);
		expect(fixed(sumInDec([isk], "ISK", undefined))).toBe("900");
		expect(() => sumInDec([isk], "USD", 1)).toThrow(MissingRateError);
	});

	describe("shares convert from their amount and rate in one division", () => {
		const share = (amount: string, currency: string, rate: string) => {
			const priced = priceShare(amount, currency, rate);
			return {
				...item(amount, currency, priced.amountInUSD),
				rate: dec(rate),
			};
		};

		it("1 EUR at 7 per USD into JPY at 17.5 is 2.5 JPY, a tie that rounds to 2", () => {
			// 1 / 7 USD x 17.5 = 17.5 / 7 = 2.5 exactly; 2 is even. Through the
			// cut USD quotient (0.142857...) it came out 2.5000...01 and showed 3.
			const total = sumInDec([share("1", "EUR", "7")], "JPY", 17.5);
			expect(fixed(total)).toBe("2.5");
			expect(roundedMinor(total, "JPY")).toBe(2);
		});

		it("two shares of 1 EUR at 13 into JPY at 22.75 are 3.5 JPY, a tie that rounds to 4", () => {
			// Each is 22.75 / 13 = 1.75; together 3.5 exactly; 4 is even. The
			// cut quotient gave 3.4999...9 and showed 3.
			const total = sumInDec(
				[share("1", "EUR", "13"), share("1", "EUR", "13")],
				"JPY",
				22.75,
			);
			expect(fixed(total)).toBe("3.5");
			expect(roundedMinor(total, "JPY")).toBe(4);
		});

		it("control, not a tie: 1 EUR at 7 into JPY at 17.6 is 2.514... and rounds to 3", () => {
			// 17.6 / 7 = 2.5142857...
			const total = sumInDec([share("1", "EUR", "7")], "JPY", 17.6);
			expect(total.toFixed(7)).toBe("2.5142857");
			expect(roundedMinor(total, "JPY")).toBe(3);
		});

		it("shares at different rates add each group's own conversion", () => {
			// 2 EUR at 8: 2 / 8 = 0.25 USD; 3 EUR at 6: 3 / 6 = 0.5 USD; into ARS at
			// 1545: 0.25 x 1545 = 386.25 and 0.5 x 1545 = 772.5; total 1158.75.
			const total = sumInDec(
				[share("2", "EUR", "8"), share("3", "EUR", "6")],
				"ARS",
				1545,
			);
			expect(fixed(total)).toBe("1158.75");
		});

		it("a share in the total's own currency counts as entered", () => {
			expect(fixed(sumInDec([share("12.5", "JPY", "150")], "JPY", 17.5))).toBe(
				"12.5",
			);
		});
	});

	it("one MissingRateError names every currency that cannot convert", () => {
		const unpriced = [
			item("900", "ISK", null),
			item("5", "CLF", null),
			item("7", "ISK", null),
		];
		const usd = item("20", "USD", "20");
		try {
			sumInDec([...unpriced, usd], "USD", 1);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(MissingRateError);
			expect((error as MissingRateError).currencies).toEqual(["CLF", "ISK"]);
		}
		// The total's own rate missing too: named with the rest.
		try {
			sumInDec([...unpriced, usd], "ARS", undefined);
			expect.unreachable();
		} catch (error) {
			expect((error as MissingRateError).currencies).toEqual([
				"ARS",
				"CLF",
				"ISK",
			]);
		}
	});

	it("10,000 mixed items total exactly and fast (grouped, not divided per item)", () => {
		// Five groups of 2000 in an ARS home at 1545:
		// own ARS 1545 each: 2000 x 1545 = 3,090,000
		// booked 10 USD at ARS 14,000: 2000 x 14,000 = 28,000,000
		// USD 1 each = 2000; EUR 2.5 USD each = 5000; BTC 60 USD each = 120,000;
		// converted: 127,000 x 1545 = 196,215,000.
		const mixed: MoneyItemDec[] = [];
		for (let i = 0; i < 2000; i++) {
			mixed.push(
				item("1545", "ARS", "1"),
				item("1", "USD", "1"),
				item("2", "EUR", "2.5"),
				item("0.001", "BTC", "60"),
				item("10", "USD", "10", { currency: "ARS", amount: "14000" }),
			);
		}
		const started = Date.now();
		const total = sumInDec(mixed, "ARS", 1545);
		const elapsed = Date.now() - started;
		expect(mixed).toHaveLength(10_000);
		expect(fixed(total)).toBe("227305000");
		expect(elapsed).toBeLessThan(250);
	});
});

describe("missingRatesIn", () => {
	it("is empty when every item is in the currency or priced, and the rate exists", () => {
		expect(missingRatesIn([item("5", "EUR", "5.5")], "ARS", 1545)).toEqual([]);
	});

	it("names an unpriced item (no USD value) and the home rate when it is missing", () => {
		const unpriced = [item("900", "ISK", null), item("20", "USD", "20")];
		expect(missingRatesIn(unpriced, "USD", 1)).toEqual(["ISK"]);
		expect(missingRatesIn(unpriced, "ARS", null)).toEqual(["ARS", "ISK"]);
	});

	it("skips an item booked in the currency, whatever its USD value", () => {
		const booked = item("20", "USD", null, {
			currency: "ARS",
			amount: "24000",
		});
		expect(missingRatesIn([booked], "ARS", null)).toEqual([]);
	});
});
