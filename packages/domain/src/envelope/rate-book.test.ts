import { describe, expect, it } from "vitest";
import { MissingRateError } from "../money";
import { RateBook, type RateRow, selectRateRows } from "./rate-book";
import { convertToBookOrThrow, valueRow } from "./valuation";

const row = (
	currency: string,
	type: string,
	date: string,
	rate: string,
): RateRow => ({ currency, type, date, rate });

// An ARS book on the blue rate, with JPY as an extra currency.
const ALL: RateRow[] = [
	row("ARS", "official", "2026-09-20", "1000"),
	row("ARS", "official", "2026-09-25", "1050"),
	row("ARS", "blue", "2026-09-28", "1400"),
	row("ARS", "official", "2026-10-02", "1100"),
	row("ARS", "blue", "2026-10-03", "1500"),
	row("ARS", "blue", "2026-10-10", "1520.5"),
	row("JPY", "official", "2026-09-30", "150.25"),
	row("JPY", "official", "2026-10-12", "151"),
	row("EUR", "official", "2026-09-30", "0.9"),
	row("USD", "official", "2026-09-30", "1"),
];
const P = {
	bookCurrency: "ARS",
	rateTypes: ["blue"],
	since: "2026-10-01",
	extraCurrencies: ["JPY"],
};

describe("selectRateRows", () => {
	it("keeps the latest row before since per pair, every row from since on, oldest first", () => {
		const keys = selectRateRows(ALL, P).map(
			(r) => `${r.currency}/${r.type}/${r.date}`,
		);
		// Anchors: ARS official 09-25 (not 09-20), ARS blue 09-28, JPY 09-30.
		// EUR was not asked for and USD is never read.
		expect(keys).toEqual([
			"ARS/official/2026-09-25",
			"ARS/blue/2026-09-28",
			"JPY/official/2026-09-30",
			"ARS/official/2026-10-02",
			"ARS/blue/2026-10-03",
			"ARS/blue/2026-10-10",
			"JPY/official/2026-10-12",
		]);
	});

	it("keeps the row stored last on a day with two rows of a pair, in either input order", () => {
		const early: RateRow = {
			...row("ARS", "card", "2026-09-30", "1040"),
			at: "2026-09-30T08:00:00.000Z",
		};
		const late: RateRow = {
			...row("ARS", "card", "2026-09-30", "1050"),
			at: "2026-09-30T20:00:00.000Z",
		};
		for (const rows of [
			[early, late],
			[late, early],
		]) {
			const card = selectRateRows(rows, P).filter((r) => r.type === "card");
			expect(card.map((r) => r.rate)).toEqual(["1050"]);
		}
		// Rows from since on keep both, oldest stored first, so the later one wins a lookup.
		const both = selectRateRows([late, early], {
			...P,
			since: "2026-09-30",
		}).filter((r) => r.type === "card");
		expect(both.map((r) => r.rate)).toEqual(["1040", "1050"]);
	});

	it("reads nothing when only USD is asked for", () => {
		expect(
			selectRateRows(ALL, { ...P, bookCurrency: "USD", extraCurrencies: [] }),
		).toEqual([]);
	});
});

describe("RateBook over selected rows", () => {
	const book = RateBook.fromRows(selectRateRows(ALL, P), P);

	it("drops the book currency's other rate types", () => {
		expect(book.lookup("ARS", "official", "2026-10-05")).toBeNull();
		expect(book.lookup("JPY", "official", "2026-10-05")).toBe("150.25");
	});

	it("looks up on or before a date, else the earliest after (nearest rate)", () => {
		expect(book.lookup("ARS", "blue", "2026-10-05")).toBe("1500");
		expect(book.lookup("ARS", "blue", "2026-10-10")).toBe("1520.5");
		expect(book.lookup("ARS", "blue", "2026-09-01")).toBe("1400");
	});

	it("onOrBefore never reaches forward", () => {
		expect(book.onOrBefore("ARS", "blue", "2026-09-01")).toBeNull();
		expect(book.onOrBefore("ARS", "blue", "2026-09-28")).toBe("1400");
		expect(book.rateDate("ARS", "blue", "2026-10-05")).toBe("2026-10-03");
	});
});

describe("valuing with a rate book (hand-derived)", () => {
	const book = RateBook.fromRows(selectRateRows(ALL, P), P);
	const ctx = (bookCurrency: string) => ({
		bookCurrency,
		periods: [],
		defaultRateType: bookCurrency === "ARS" ? "blue" : "official",
		usdRate: book.lookup,
	});
	const usd = (amountInUSD: string, month = 202610) => ({
		id: "r",
		amount: amountInUSD,
		currency: "USD",
		date: "2026-10-05",
		month,
	});

	it("ARS on blue: 12.34 USD x 1500 = 18,510.00 ARS", () => {
		expect(valueRow(usd("12.34"), ctx("ARS"))).toMatchObject({
			ok: true,
			minor: 1_851_000,
			rateType: "blue",
		});
	});

	it("JPY has no decimals: 12.5 USD x 150.25 = 1,878.125 rounds half-even to 1,878", () => {
		expect(valueRow(usd("12.5"), ctx("JPY"))).toMatchObject({
			ok: true,
			minor: 1878,
		});
	});

	it("a book with no rate for its currency leaves the row out and says which rate", () => {
		const v = valueRow(usd("10"), ctx("EUR"));
		expect(v).toMatchObject({
			ok: false,
			missing: { currency: "EUR", rateType: "official", date: "2026-10-05" },
		});
	});

	it("a missing rate throws MissingRateError, never 1", () => {
		expect(() =>
			convertToBookOrThrow(
				"10",
				"EUR",
				{ date: "2026-10-05", month: 202610, foreignRateType: "official" },
				ctx("ARS"),
			),
		).toThrow(MissingRateError);
	});
});
