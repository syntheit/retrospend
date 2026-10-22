import { describe, expect, it } from "vitest";
import { bookContext } from "./test-fixtures";
import { MissingRateError } from "./types";
import {
	type BookPeriod,
	convertToBook,
	convertToBookOrThrow,
	rateTypeForMonth,
	sumRows,
	type ValuationRow,
	valueRow,
} from "./valuation";

const row = (
	o: Partial<ValuationRow> & Pick<ValuationRow, "amount" | "currency">,
): ValuationRow => ({
	id: "r1",
	date: "2026-10-20",
	month: 202610,
	...o,
});

const BLUE_FROM_OCT: BookPeriod[] = [
	{ fromMonth: 202610, startDay: 1, rateType: "blue" },
];
const OFFICIAL_THEN_BLUE: BookPeriod[] = [
	{ fromMonth: 202601, startDay: 1, rateType: "official" },
	{ fromMonth: 202611, startDay: 1, rateType: "blue" },
];

describe("valueRow", () => {
	it.each([
		{
			name: "home row as entered (ARS 30,000 in an ARS book)",
			book: "ARS",
			periods: [],
			r: row({ amount: "30000", currency: "ARS" }),
			minor: 3_000_000,
			source: "BOOK_CURRENCY",
		},
		{
			name: "S2 add to budget now: USD 2,400 in a BRL book at 5.40",
			book: "BRL",
			periods: [],
			r: row({ amount: "2400", currency: "USD", date: "2026-10-19" }),
			minor: 1_296_000,
			source: "BOOK_RATE",
		},
		{
			name: "B9 blue-rate book: USD 100 at blue 1,465",
			book: "ARS",
			periods: BLUE_FROM_OCT,
			r: row({ amount: "100", currency: "USD" }),
			minor: 14_650_000,
			source: "BOOK_RATE",
		},
		{
			name: "D43 the row's own rate into H wins over the book rate type",
			book: "ARS",
			periods: BLUE_FROM_OCT,
			r: row({
				amount: "100",
				currency: "USD",
				ownRate: { to: "ARS", perUnit: "1490" },
			}),
			minor: 14_900_000,
			source: "OWN_RATE",
		},
		{
			name: "an own rate into another currency is ignored",
			book: "ARS",
			periods: BLUE_FROM_OCT,
			r: row({
				amount: "100",
				currency: "USD",
				ownRate: { to: "BRL", perUnit: "5.5" },
			}),
			minor: 14_650_000,
			source: "BOOK_RATE",
		},
		{
			name: "C20 BookPeriod boundary: October row stays at official",
			book: "ARS",
			periods: OFFICIAL_THEN_BLUE,
			r: row({
				amount: "100",
				currency: "USD",
				date: "2026-10-30",
				month: 202610,
			}),
			minor: 14_120_000,
			source: "BOOK_RATE",
		},
		{
			name: "C20 BookPeriod boundary: November row uses blue",
			book: "ARS",
			periods: OFFICIAL_THEN_BLUE,
			r: row({
				amount: "100",
				currency: "USD",
				date: "2026-11-02",
				month: 202611,
			}),
			minor: 14_650_000,
			source: "BOOK_RATE",
		},
		{
			name: "cross currency through the stored amountInUSD (BRL row, ARS blue book)",
			book: "ARS",
			periods: BLUE_FROM_OCT,
			r: row({ amount: "540", currency: "BRL", amountInUSD: "100.00" }),
			minor: 14_650_000,
			source: "BOOK_RATE",
		},
		{
			name: "crypto row: 0.001 BTC through its stored amountInUSD",
			book: "USD",
			periods: [],
			r: row({ amount: "0.001", currency: "BTC", amountInUSD: "64.55" }),
			minor: 6_455,
			source: "BOOK_RATE",
		},
		{
			name: "crypto book: USD 100 in a BTC book (rate is USD per coin)",
			book: "BTC",
			periods: [{ fromMonth: 202601, startDay: 1, rateType: "market" }],
			r: row({ amount: "100", currency: "USD" }),
			minor: 154_931,
			source: "BOOK_RATE",
		},
		{
			name: "rounding JPY (0 decimals): USD 10.01 = 1,504.0025 JPY",
			book: "JPY",
			periods: [],
			r: row({ amount: "10.01", currency: "USD" }),
			minor: 1_504,
			source: "BOOK_RATE",
		},
		{
			name: "rounding KWD (3 decimals): USD 10 = 3.075 KWD",
			book: "KWD",
			periods: [],
			r: row({ amount: "10", currency: "USD" }),
			minor: 3_075,
			source: "BOOK_RATE",
		},
		{
			name: "rounding EUR (2 decimals): USD 10.01 = 9.2092 EUR",
			book: "EUR",
			periods: [],
			r: row({ amount: "10.01", currency: "USD" }),
			minor: 921,
			source: "BOOK_RATE",
		},
	])("$name", ({ book, periods, r, minor, source }) => {
		const v = valueRow(r, bookContext(book, { periods }));
		expect(v).toMatchObject({ ok: true, minor, source });
	});

	it.each([
		{
			name: "C18 a foreign row with no rate is left out, never valued at 1",
			book: "ARS",
			r: row({ amount: "10000", currency: "CLP" }),
			currency: "CLP",
		},
		{
			name: "C18 a missing book-currency rate is flagged too",
			book: "CLP",
			r: row({ amount: "10", currency: "USD" }),
			currency: "CLP",
		},
		{
			name: "C18 a rate type with no rows is missing, not another type",
			book: "BRL",
			r: row({ amount: "10", currency: "USD", month: 202610 }),
			currency: "BRL",
			periods: BLUE_FROM_OCT,
		},
	])("$name", ({ book, r, currency, periods }) => {
		const v = valueRow(r, bookContext(book, { periods: periods ?? [] }));
		expect(v).toEqual({
			ok: false,
			missing: expect.objectContaining({ currency, rowId: "r1", date: r.date }),
		});
	});
});

describe("sumRows", () => {
	it("C18 sums the rows it can value and flags the figure incomplete", () => {
		const ctx = bookContext("ARS", { periods: BLUE_FROM_OCT });
		const out = sumRows(
			[
				row({ id: "a", amount: "30000", currency: "ARS" }),
				row({ id: "b", amount: "100", currency: "USD" }),
				row({ id: "c", amount: "5000", currency: "CLP" }),
			],
			ctx,
		);
		expect(out.minor).toBe(3_000_000 + 14_650_000);
		expect(out.incomplete).toBe(true);
		expect(out.missingRates).toEqual([
			{ currency: "CLP", rateType: null, date: "2026-10-20", rowId: "c" },
		]);
		expect([...out.values.keys()]).toEqual(["a", "b"]);
	});

	it("per-row rounding: each row is rounded before the integer sum", () => {
		const ctx = bookContext("EUR");
		const rows = [1, 2, 3].map((i) =>
			row({ id: `u${i}`, amount: "0.53", currency: "USD" }),
		);
		// 3 x 0.4876 = 1.4628 unrounded; the book sums 3 x 0.49.
		expect(sumRows(rows, ctx).minor).toBe(147);
	});

	it("an empty set is a complete zero", () => {
		expect(sumRows([], bookContext("ARS"))).toMatchObject({
			minor: 0,
			incomplete: false,
		});
	});
});

describe("convertToBook (targets at today's rate, D25)", () => {
	const ctx = bookContext("ARS", { periods: BLUE_FROM_OCT });

	it.each([
		{
			name: "S10 USD 2,000 at blue 1,465 in October",
			date: "2026-10-22",
			month: 202610,
			minor: 293_000_000,
		},
		{
			name: "S10 the same target at blue 1,530 in January",
			date: "2027-01-05",
			month: 202701,
			minor: 306_000_000,
		},
	])("$name", ({ date, month, minor }) => {
		expect(convertToBookOrThrow("2000", "USD", { date, month }, ctx)).toBe(
			minor,
		);
	});

	it.each([
		{
			name: "D25 EUR 1,000 target: EUR leg at official 0.92, ARS leg at blue",
			amount: "1000",
			currency: "EUR",
			foreignRateType: "official",
			minor: 159_239_130,
		},
		{
			name: "D25 crypto target: 0.01 BTC at USD 64,545 per coin",
			amount: "0.01",
			currency: "BTC",
			foreignRateType: "market",
			minor: 94_558_425,
		},
	])("$name", ({ amount, currency, foreignRateType, minor }) => {
		const on = { date: "2026-10-22", month: 202610, foreignRateType };
		expect(convertToBookOrThrow(amount, currency, on, ctx)).toBe(minor);
	});

	it("a third currency without a named rate type is missing, never guessed", () => {
		const v = convertToBook(
			"1000",
			"EUR",
			{ date: "2026-10-22", month: 202610 },
			ctx,
		);
		expect(v).toEqual({
			ok: false,
			missing: { currency: "EUR", rateType: null, date: "2026-10-22" },
		});
	});

	it("throws MissingRateError when the target currency has no rate", () => {
		const on = {
			date: "2026-10-22",
			month: 202610,
			foreignRateType: "official",
		};
		expect(() => convertToBookOrThrow("100", "CLP", on, ctx)).toThrow(
			MissingRateError,
		);
		expect(convertToBook("100", "CLP", on, ctx).ok).toBe(false);
	});
});

describe("rateTypeForMonth", () => {
	it.each([
		{ month: 202512, type: "official", why: "before any period: the default" },
		{ month: 202610, type: "official", why: "inside the first period" },
		{ month: 202611, type: "blue", why: "from the boundary on" },
		{ month: 202703, type: "blue", why: "later months keep the last period" },
	])("$month is $type ($why)", ({ month, type }) => {
		expect(
			rateTypeForMonth(month, {
				periods: OFFICIAL_THEN_BLUE,
				defaultRateType: "official",
			}),
		).toBe(type);
	});
});

describe("fiat rates multiply, never divide by an inverse", () => {
	const sevenPerUsd = (c: string) => (c === "ARS" ? "7" : null);

	it("USD 0.005 at 7 ARS per USD is 0.035 ARS = 3.5 minor, half-even to 4", () => {
		const v = valueRow(
			row({ amount: "0.005", currency: "USD" }),
			bookContext("ARS", { usdRate: sevenPerUsd }),
		);
		expect(v).toMatchObject({ ok: true, minor: 4 });
	});

	it("ARS 0.245 at 7 ARS per USD is USD 0.035 = 3.5 cents, half-even to 4", () => {
		const on = {
			date: "2026-10-22",
			month: 202610,
			foreignRateType: "official",
		};
		expect(
			convertToBookOrThrow(
				"0.245",
				"ARS",
				on,
				bookContext("USD", { usdRate: sevenPerUsd }),
			),
		).toBe(4);
	});

	it("a zero or negative rate is missing, never used", () => {
		const v = valueRow(
			row({ amount: "1", currency: "USD" }),
			bookContext("ARS", { usdRate: () => "0" }),
		);
		expect(v.ok).toBe(false);
	});
});
