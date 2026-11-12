import { describe, expect, it } from "vitest";
import { MissingRateError } from "./money";
import {
	type BookContext,
	bookRate,
	parseRateDefaults,
	preferredRateType,
	type RateChoice,
	RateInputError,
	rateChoice,
	rateTypeFromPricingSource,
	type SavedRate,
	storedAmount,
} from "./rate-booking";

const DATE = new Date("2026-03-05T12:00:00Z");

/** Rates per currency as { rate per USD (crypto: USD per unit), type }; USD never asks. */
const table = (
	rates: Record<string, { rate: number; type: string }>,
	home: string,
	preferred: string | null = null,
): BookContext => ({
	homeCurrency: home,
	preferred,
	find: async (currency, date) => {
		const hit = rates[currency];
		return hit ? { ...hit, date, onOrBefore: true } : null;
	},
});

const book = (
	ctx: BookContext,
	amount: string,
	currency: string,
	choice: RateChoice = { kind: "table", rateType: null },
) => bookRate(ctx, { amount, currency, date: DATE }, choice);

describe("bookRate with a BTC home (crypto rates are USD per unit)", () => {
	const btc = table({ BTC: { rate: 50000, type: "crypto" } }, "BTC");

	it("USD 100 into BTC: homeRate 1 / 50000 = 0.00002, home amount 100 x 0.00002 = 0.002 at 8 decimals", async () => {
		expect(await book(btc, "100", "USD")).toEqual({
			exchangeRate: "1",
			amountInUSD: "100.00",
			rateType: "crypto",
			homeCurrency: "BTC",
			homeRate: "0.00002",
			homeAmount: "0.00200000",
		});
	});

	it("BTC 0.5 in a USD home: the entry leg is 50000, homeRate 50000, USD value 0.5 x 50000 = 25000", async () => {
		expect(
			await book(
				table({ BTC: { rate: 50000, type: "crypto" } }, "USD"),
				"0.5",
				"BTC",
			),
		).toEqual({
			exchangeRate: "50000",
			amountInUSD: "25000.00",
			rateType: "crypto",
			homeCurrency: "USD",
			homeRate: "50000",
			homeAmount: "25000.00",
		});
	});

	it("ARS into BTC: (1 / 1000) / 50000 = 0.00000002, so 123456789 ARS is 2.46913578 BTC", async () => {
		const ctx = table(
			{
				ARS: { rate: 1000, type: "official" },
				BTC: { rate: 50000, type: "crypto" },
			},
			"BTC",
		);
		const booked = await book(ctx, "123456789", "ARS");
		expect(booked.homeRate).toBe("0.00000002");
		expect(booked.homeAmount).toBe("2.46913578");
		// The home leg used crypto, the entry leg official: crypto is not official, so it labels.
		expect(booked.rateType).toBe("crypto");
	});

	it("a tiny rate keeps its digits: ARS 10,000,000 in a BTC home", async () => {
		// 1 / 1,560 / 64,545.9 = 1 / 100,691,604 = 9.931...e-9 BTC per ARS, stored
		// as 0.000000009931. The amount uses the exact rate: 10,000,000 /
		// 100,691,604 = 0.09931315 BTC, where the stored copy gives 0.09931000.
		const ctx = table(
			{
				ARS: { rate: 1560, type: "blue" },
				BTC: { rate: 64545.9, type: "crypto" },
			},
			"BTC",
		);
		const booked = await book(ctx, "10000000", "ARS");
		expect(booked.homeRate).toBe("0.000000009931");
		expect(booked.homeAmount).toBe("0.09931315");
	});

	it("a BTC home with no BTC rate throws, naming BTC", async () => {
		const none = table({}, "BTC");
		await expect(book(none, "100", "USD")).rejects.toMatchObject({
			name: "MissingRateError",
			currencies: ["BTC"],
		});
		await expect(book(none, "100", "USD")).rejects.toBeInstanceOf(
			MissingRateError,
		);
	});
});

describe("bookRate choices", () => {
	const ars = table(
		{
			ARS: { rate: 1545, type: "blue" },
			EUR: { rate: 0.8, type: "official" },
		},
		"ARS",
		"blue",
	);

	it("kept books the saved legs and reads no rate", async () => {
		const never: BookContext = {
			homeCurrency: "ARS",
			preferred: null,
			find: () => {
				throw new Error("a kept rate needs no lookup");
			},
		};
		// USD 10 at the saved home rate 1545.5 is 15455.00.
		expect(
			await book(never, "10", "USD", {
				kind: "kept",
				exchangeRate: 1,
				homeRate: "1545.5",
				rateType: "blue",
			}),
		).toMatchObject({ homeRate: "1545.5", homeAmount: "15455.00" });
	});

	it("a typed entry leg labels custom and takes the home leg from the default", async () => {
		// EUR 0.5 per USD is 2 USD per EUR; times ARS blue 1545 is 3090 per EUR.
		expect(
			await book(ars, "100", "EUR", {
				kind: "entryLeg",
				exchangeRate: 0.5,
				rateType: "custom",
			}),
		).toMatchObject({
			exchangeRate: "0.5",
			amountInUSD: "200.00",
			rateType: "custom",
			homeRate: "3090",
			homeAmount: "309000.00",
		});
	});

	it("an entry leg of a table type is labeled by the home leg first: blue before mep", async () => {
		// Legs are home (blue) then entry (mep); with no type asked, the first that is not official labels.
		expect(
			await book(ars, "10", "EUR", {
				kind: "entryLeg",
				exchangeRate: 0.8,
				rateType: "mep",
			}),
		).toMatchObject({ rateType: "blue" });
	});

	it("a typed rate must convert the pair's currencies and be above zero", async () => {
		await expect(
			book(ars, "10", "ARS", { kind: "custom", base: "ARS", value: "2" }),
		).rejects.toBeInstanceOf(RateInputError);
		await expect(
			book(ars, "10", "EUR", { kind: "custom", base: "USD", value: "2" }),
		).rejects.toBeInstanceOf(RateInputError);
		await expect(
			book(ars, "10", "USD", { kind: "custom", base: "USD", value: "0" }),
		).rejects.toBeInstanceOf(RateInputError);
	});

	it("a typed rate quoted in the home currency is inverted: 1 ARS = 0.001 USD is 1000 ARS per USD", async () => {
		// perUnit of USD is 1 / 0.001 = 1000, so 10 USD is 10000.00 ARS.
		expect(
			await book(ars, "10", "USD", { kind: "custom", base: "ARS", value: "0.001" }),
		).toMatchObject({ homeRate: "1000", homeAmount: "10000.00", rateType: "custom" });
	});
});

describe("bookRate rounds half to even from the exact rate", () => {
	const ars = table({ ARS: { rate: 100, type: "official" } }, "ARS");

	it("ARS ties at 100 per USD: 28.5 is 0.285 USD, so 0.28 (8 is even); refunds mirror", async () => {
		expect(await book(ars, "28.5", "ARS")).toMatchObject({
			exchangeRate: "100",
			amountInUSD: "0.28",
			homeRate: "1",
			homeAmount: "28.50",
		});
		expect((await book(ars, "-28.5", "ARS")).amountInUSD).toBe("-0.28");
		// -1.5 / 100 = -0.015: 1 is odd, so -0.02 (half up gave -0.01).
		expect((await book(ars, "-1.5", "ARS")).amountInUSD).toBe("-0.02");
		// 0.5 / 100 = 0.005 rounds to 0.00, and its refund never reads "-0.00".
		expect((await book(ars, "0.5", "ARS")).amountInUSD).toBe("0.00");
		expect((await book(ars, "-0.5", "ARS")).amountInUSD).toBe("0.00");
	});

	it("KWD 1.0035 at 0.3 per USD is 3.345 USD, one division: 3.34", async () => {
		const kwd = table({ KWD: { rate: 0.3, type: "official" } }, "KWD");
		expect(await book(kwd, "1.0035", "KWD")).toMatchObject({
			amountInUSD: "3.34",
			homeAmount: "1.004",
		});
		// The home amount 1.0035 is a tie at 3 decimals too: 3 is odd, so 1.004.
	});

	it("BTC 0.0000001 at 50000 USD per coin is 0.005 USD: 0.00", async () => {
		const usd = table({ BTC: { rate: 50000, type: "crypto" } }, "USD");
		expect(await book(usd, "0.0000001", "BTC")).toMatchObject({
			amountInUSD: "0.00",
			homeAmount: "0.00",
		});
	});

	it("a BTC home: USD 0.0006 at 40000 is 0.000000015 BTC, a tie at 8 decimals: 0.00000002", async () => {
		const btc = table({ BTC: { rate: 40000, type: "crypto" } }, "BTC");
		// 0.0006 x 1 / (1 x 40000) = 0.000000015; 1 is odd, so 2 at the 8th decimal.
		expect((await book(btc, "0.0006", "USD")).homeAmount).toBe("0.00000002");
	});

	it("EUR 4.5 at 3 per USD into a JPY home at 1 per USD: one division gives 1.5, so 2 JPY (D3)", async () => {
		const jpy = table(
			{
				EUR: { rate: 3, type: "official" },
				JPY: { rate: 1, type: "official" },
			},
			"JPY",
		);
		// cross = (1 / 3) / (1 / 1) = 0.333...; 4.5 x 1 x 1 / (3 x 1) = 1.5 exactly,
		// a tie at 0 decimals: 1 is odd, so 2. 4.5 x 0.333...3 (40 digits) gave 1.
		// USD value 4.5 / 3 = 1.50.
		expect(await book(jpy, "4.5", "EUR")).toEqual({
			exchangeRate: "3",
			amountInUSD: "1.50",
			rateType: "official",
			homeCurrency: "JPY",
			homeRate: "0.333333333333",
			homeAmount: "2",
		});
	});

	it("a typed rate prices USD from the exact rate, not the 6-decimal exchangeRate (D4)", async () => {
		const ctx = table({ ARS: { rate: 1545, type: "blue" } }, "ARS", "blue");
		// 1 EUR = 1546 ARS at blue 1545 per USD: 1546 / 1545 USD per EUR. EUR
		// 100,000 is 154,600,000 / 1545 = 100,064.7249... USD, so 100,064.72.
		// The stored leg is 1545 / 1546 = 0.99935316... to 6 decimals 0.999353,
		// which would give 100,000 / 0.999353 = 100,064.7418... = 100,064.74.
		expect(
			await book(ctx, "100000", "EUR", {
				kind: "custom",
				base: "EUR",
				value: "1546",
			}),
		).toEqual({
			exchangeRate: "0.999353",
			amountInUSD: "100064.72",
			rateType: "custom",
			homeCurrency: "ARS",
			homeRate: "1546",
			homeAmount: "154600000.00",
		});
	});

	it("a typed rate quoted in the home currency divides once: 1 JPY = 3 ARS makes ARS 4.5 into 2 JPY", async () => {
		const jpy = table(
			{
				ARS: { rate: 1000, type: "official" },
				JPY: { rate: 1, type: "official" },
			},
			"JPY",
		);
		// 1 JPY = 3 ARS, so ARS 4.5 is 4.5 / 3 = 1.5 JPY exactly: 2. The home
		// rate is 1 / 3 to 12 decimals. USD = 1.5 JPY at 1 per USD = 1.50.
		expect(
			await book(jpy, "4.5", "ARS", {
				kind: "custom",
				base: "JPY",
				value: "3",
			}),
		).toMatchObject({
			amountInUSD: "1.50",
			homeRate: "0.333333333333",
			homeAmount: "2",
		});
	});
});

describe("bookRate from a USD value (a file's USD column)", () => {
	const ars = table({ ARS: { rate: 1545, type: "blue" } }, "ARS", "blue");
	const usdValue = (usd: string): RateChoice => ({ kind: "usdValue", usd });

	it("ARS 7 for USD 0.015 stores 0.02: USD per unit is 0.015 / 7, never a rounded rate", async () => {
		// 7 x 0.015 / 7 = 0.015 USD exactly, a tie: 1 is odd, so 0.02. No
		// rate 7 / 0.015 = 466.666... (cut at 40 digits) stands in between.
		// The leg is 466.666667 at 6 decimals; ARS is the home, so 7.00.
		expect(await book(ars, "7", "ARS", usdValue("0.015"))).toEqual({
			exchangeRate: "466.666667",
			amountInUSD: "0.02",
			rateType: null,
			homeCurrency: "ARS",
			homeRate: "1",
			homeAmount: "7.00",
		});
	});

	it("EUR 7 for USD 0.015 into ARS blue: one division keeps the home tie", async () => {
		// Home units per EUR = (0.015 / 7) x 1545 = 23.175 / 7, so EUR 7 is
		// 23.175 ARS exactly, a tie: 7 is odd, so 23.18. The home rate
		// 3.310714285714|2857... is 3.310714285714 at 12 decimals. The home leg
		// is blue, the file's leg has no type: labeled blue.
		expect(await book(ars, "7", "EUR", usdValue("0.015"))).toEqual({
			exchangeRate: "466.666667",
			amountInUSD: "0.02",
			rateType: "blue",
			homeCurrency: "ARS",
			homeRate: "3.310714285714",
			homeAmount: "23.18",
		});
	});

	it("BTC 0.00000025 for USD 0.015 into a USD home is 60000 per coin and 0.02", async () => {
		// Crypto leg: USD / amount = 0.015 / 0.00000025 = 60000 USD per coin.
		// 0.015 USD is a tie at cents: 0.02 both as amountInUSD and home.
		const usd = table({}, "USD");
		expect(
			await book(usd, "0.00000025", "BTC", usdValue("0.015")),
		).toMatchObject({
			exchangeRate: "60000",
			amountInUSD: "0.02",
			homeRate: "60000",
			homeAmount: "0.02",
		});
	});

	it("a USD value of 0 prices no rate: MissingRateError, never 1", async () => {
		await expect(
			book(ars, "7", "EUR", usdValue("0")),
		).rejects.toBeInstanceOf(MissingRateError);
		// An amount of 0 prices none either: fiat 0 / 5 is a rate of 0, crypto
		// 5 / 0 has none.
		await expect(
			book(ars, "0", "ARS", usdValue("5")),
		).rejects.toBeInstanceOf(MissingRateError);
		await expect(
			book(table({}, "USD"), "0", "BTC", usdValue("5")),
		).rejects.toBeInstanceOf(MissingRateError);
	});
});

describe("bookRate keeps the figures of an edit that moves no money (D1)", () => {
	const ars = table({ ARS: { rate: 100, type: "official" } }, "ARS");
	// ARS 28.5 booked half up before half even: 0.285 USD was saved as 0.29.
	const saved: SavedRate = {
		currency: "ARS",
		exchangeRate: 100,
		rateType: "official",
		homeCurrency: "ARS",
		homeRate: "1",
		amount: "28.5",
		date: DATE,
		amountInUSD: "0.29",
		homeAmount: "28.50",
	};
	const kept: RateChoice = {
		kind: "kept",
		exchangeRate: 100,
		homeRate: "1",
		rateType: "official",
	};
	const edit = (amount: string, date = DATE, choice: RateChoice = kept) =>
		bookRate(ars, { amount, currency: "ARS", date }, choice, saved);

	it("an untouched edit returns the saved USD value and home amount", async () => {
		expect(await edit("28.5")).toMatchObject({
			amountInUSD: "0.29",
			homeAmount: "28.50",
		});
		// The same decimal written longer is the same amount.
		expect((await edit("28.50000000")).amountInUSD).toBe("0.29");
		// A table booking of the same rate keeps them too.
		expect(
			(await edit("28.5", DATE, { kind: "table", rateType: null })).amountInUSD,
		).toBe("0.29");
	});

	it("a new amount re-books: 30 / 100 = 0.30", async () => {
		expect(await edit("30")).toMatchObject({
			amountInUSD: "0.30",
			homeAmount: "30.00",
		});
	});

	it("a new date re-books at the kept rate: 28.5 / 100 = 0.285, so 0.28", async () => {
		const later = new Date("2026-03-06T12:00:00Z");
		expect((await edit("28.5", later)).amountInUSD).toBe("0.28");
	});

	it("a different rate re-books: 28.5 / 95 = 0.30", async () => {
		const moved = table({ ARS: { rate: 95, type: "official" } }, "ARS");
		const rate = await bookRate(
			moved,
			{ amount: "28.5", currency: "ARS", date: DATE },
			{ kind: "table", rateType: null },
			saved,
		);
		expect(rate).toMatchObject({ exchangeRate: "95", amountInUSD: "0.30" });
	});

	it("a row saved before home amounts existed re-books", async () => {
		const rate = await bookRate(
			ars,
			{ amount: "28.5", currency: "ARS", date: DATE },
			kept,
			{ ...saved, homeAmount: null },
		);
		expect(rate).toMatchObject({ amountInUSD: "0.28", homeAmount: "28.50" });
	});
});

describe("storedAmount", () => {
	it("keeps 8 decimals, half to even, sign symmetric", () => {
		// 1.000000005 is a tie at 8 decimals: 0 is even, so 1.00000000.
		expect(storedAmount("1.000000005")).toBe("1");
		// 1.000000015: 1 is odd, so 1.00000002; the refund mirrors it.
		expect(storedAmount("1.000000015")).toBe("1.00000002");
		expect(storedAmount("-1.000000015")).toBe("-1.00000002");
		expect(storedAmount("12.34")).toBe("12.34");
	});
});

describe("rateChoice", () => {
	const input = { amount: "10", currency: "USD", date: DATE };
	const saved: SavedRate = {
		currency: "USD",
		exchangeRate: 1,
		rateType: "blue",
		homeCurrency: "ARS",
		homeRate: "1545",
		amount: "10",
		date: DATE,
		amountInUSD: "10.00",
		homeAmount: "15450.00",
	};

	it("a typed rate wins over everything", () => {
		expect(
			rateChoice({ ...input, customRate: { base: "USD", value: "2" } }, saved, "ARS"),
		).toEqual({ kind: "custom", base: "USD", value: "2" });
	});

	it("an edit that leaves the rate alone keeps both legs when booked in today's home", () => {
		expect(rateChoice(input, saved, "ARS")).toEqual({
			kind: "kept",
			exchangeRate: 1,
			homeRate: "1545",
			rateType: "blue",
		});
	});

	it("an untouched edit under another home keeps the entry leg only", () => {
		expect(rateChoice(input, saved, "EUR")).toEqual({
			kind: "entryLeg",
			exchangeRate: 1,
			rateType: "blue",
		});
	});

	it("a changed type or currency books from the table", () => {
		expect(rateChoice({ ...input, rateType: "official" }, saved, "ARS")).toEqual({
			kind: "table",
			rateType: "official",
		});
		expect(rateChoice({ ...input, currency: "EUR" }, saved, "ARS")).toEqual({
			kind: "table",
			rateType: null,
			entryType: null,
		});
	});

	it("a legacy pricingSource names the entry leg's type, but never for USD", () => {
		expect(
			rateChoice({ ...input, currency: "EUR", pricingSource: "official" }, null, "ARS"),
		).toEqual({ kind: "table", rateType: null, entryType: "official" });
		expect(rateChoice({ ...input, pricingSource: "official" }, null, "ARS")).toEqual({
			kind: "table",
			rateType: null,
			entryType: null,
		});
	});

	it("the custom type needs a non-USD entry and a valid typed leg", () => {
		expect(
			rateChoice(
				{ ...input, currency: "EUR", rateType: "custom", exchangeRate: 0.5 },
				null,
				"ARS",
			),
		).toEqual({ kind: "entryLeg", exchangeRate: 0.5, rateType: "custom" });
		for (const bad of [
			{ currency: "EUR", rateType: "custom" },
			{ currency: "EUR", rateType: "custom", exchangeRate: 0 },
			{ currency: "USD", rateType: "custom", exchangeRate: 1 },
		])
			expect(() => rateChoice({ ...input, ...bad }, null, "ARS")).toThrow(
				RateInputError,
			);
	});
});

describe("rate type helpers", () => {
	it("a pricingSource names a type unless it is a placeholder or free text", () => {
		expect(rateTypeFromPricingSource(" Blue ")).toBe("blue");
		const placeholders = "MANUAL Import Imported recurring".split(" ");
		for (const none of [...placeholders, "Some Bank!", "", null])
			expect(rateTypeFromPricingSource(none)).toBeNull();
	});

	it("saved defaults keep well-formed pairs only; custom is never a default", () => {
		expect(
			parseRateDefaults({ ARS: "official", usd: "blue", BRL: "Bad Type", EUR: "custom" }),
		).toEqual({ ARS: "official" });
		expect(parseRateDefaults(["ARS"])).toEqual({});
		expect(parseRateDefaults(null)).toEqual({});
	});

	it("the preference is the saved default, else the built-in ARS blue, else none", () => {
		expect(preferredRateType("ARS", { ARS: "official" })).toBe("official");
		expect(preferredRateType("ARS", {})).toBe("blue");
		expect(preferredRateType("JPY", {})).toBeNull();
	});
});
