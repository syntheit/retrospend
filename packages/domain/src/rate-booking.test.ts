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
			exchangeRate: 1,
			amountInUSD: 100,
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
			exchangeRate: 50000,
			amountInUSD: 25000,
			rateType: "crypto",
			homeCurrency: "USD",
			homeRate: "50000",
			homeAmount: "25000.00",
		});
	});

	it("ARS into BTC keeps a tiny rate exact: (1 / 1000) / 50000 = 0.00000002, so 123456789 ARS is 2.46913578 BTC", async () => {
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
			exchangeRate: 0.5,
			amountInUSD: 200,
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

describe("rateChoice", () => {
	const input = { amount: "10", currency: "USD", date: DATE };
	const saved: SavedRate = {
		currency: "USD",
		exchangeRate: 1,
		rateType: "blue",
		homeCurrency: "ARS",
		homeRate: "1545",
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
