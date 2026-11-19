/**
 * Vectors for expense edit. Every expected value is derived by hand in the
 * comment above it, from these rules (editExpense, rateChoice and bookRate):
 *
 * - An edit that leaves the currency, the rate and the type alone keeps both
 *   legs of the rate the expense was saved with: its homeRate and its
 *   entry leg. A later table rate never moves it. The home amount is the new
 *   amount times the kept homeRate, half to even at the home currency's
 *   decimals (JPY 0, KWD 3); amountInUSD is the amount at the kept entry leg,
 *   to cents.
 * - A changed currency or an explicit rate type books both legs again from
 *   the table, as a create does (expense-create-vectors.ts).
 * - A date edit alone keeps the booked rate too: only a new rate choice reads
 *   the table.
 * - An amount that stores as 0 at 8 decimals is refused with the domain's
 *   words before any rate is read; a currency with no rate is a
 *   MissingRateError, never a rate of 1.
 * - A refused edit leaves the row as it was.
 *
 * Rates and dates are in UTC; instants carry their zone in the comment.
 */
import { AMOUNT_ABOVE_ZERO } from "@retrospend/domain/expense-write/refusals";
import type { CreateExpenseInput } from "./expense-create";
import type { ExpectedMoney, ExpenseSeed } from "./expense-create-conformance";
import type { EditVector } from "./expense-edit-conformance";
import { arsHome, at, BA, D, rate, seed, WHEN } from "./expense-create-vectors";

const base = (
	over: Partial<CreateExpenseInput> & { amount: string; currency: string },
): CreateExpenseInput => ({ id: "e1", title: "Lunch", date: WHEN, ...over });

const money = (m: ExpectedMoney) => ({ booked: m });

const jpy = seed("JPY", "Asia/Tokyo", [rate("JPY", "official", "125", D)]);
const kwd = seed("KWD", "Asia/Kuwait", [rate("KWD", "official", "0.25", D)]);

/** BA is UTC-3 all year; its rate rows: blue 1500 from Mar 31, 1600 from Apr 1 00:00Z. */
const baEdge: ExpenseSeed = seed("ARS", BA, [
	rate("ARS", "blue", "1500", "2026-03-31T00:00:00Z"),
	rate("ARS", "blue", "1600", "2026-04-01T00:00:00Z"),
]);

/** Buenos Aires' March and April as fiscal months (start day 1). */
const march = (counts: boolean) => ({
	year: 2026,
	month: 2,
	start: "2026-03-01T03:00:00.000Z",
	end: "2026-04-01T02:59:59.999Z",
	counts,
});
const april = (counts: boolean) => ({
	year: 2026,
	month: 3,
	start: "2026-04-01T03:00:00.000Z",
	end: "2026-05-01T02:59:59.999Z",
	counts,
});

/** What a USD expense books at JPY 125 or KWD 0.25 per USD: legs 1, the official type. */
const official = (
	home: string,
	homeRate: string,
	amount: string,
	homeAmount: string,
): ExpectedMoney => ({
	amount,
	amountInUSD: amount,
	exchangeRate: "1",
	rateType: "official",
	homeCurrency: home,
	homeRate,
	homeAmount,
});

export const editVectors: EditVector[] = [
	// ARS blue 1545 booked USD 100 = 154500.00. The table is rewritten to 1600
	// before the edit. USD 120 keeps homeRate 1545: 120 x 1545 = 185400.00
	// (a rebook at 1600 would give 192000.00). Spent moves by 185400 - 154500
	// = 30900.00.
	{
		name: "ARS home: 100 to 120 keeps the booked blue 1545, home amount 185400.00",
		seed: arsHome,
		base: base({ amount: "100", currency: "USD" }),
		ratesThen: [rate("ARS", "blue", "1600", D)],
		edit: { amount: "120" },
		expect: money({
			amount: "120",
			amountInUSD: "120",
			exchangeRate: "1",
			rateType: "blue",
			homeCurrency: "ARS",
			homeRate: "1545",
			homeAmount: "185400.00",
		}),
	},
	// A title alone moves no money: both legs and the home amount stay.
	{
		name: "ARS home: a title edit keeps the saved figures after the table moved",
		seed: arsHome,
		base: base({ amount: "100", currency: "USD" }),
		ratesThen: [rate("ARS", "blue", "1600", D)],
		edit: { title: "Dinner" },
		expect: money({
			amount: "100",
			amountInUSD: "100",
			exchangeRate: "1",
			rateType: "blue",
			homeCurrency: "ARS",
			homeRate: "1545",
			homeAmount: "154500.00",
		}),
	},
	// USD 100 to EUR 50 at the official type: both legs from the table, as the
	// create vector derives: EUR 0.8 per USD is 1.25 USD per EUR, ARS official
	// 1000 is 0.001 USD per ARS, homeRate = 1.25 / 0.001 = 1250, homeAmount =
	// 50 x 1250 = 62500.00, USD value = 50 x 1.25 = 62.50.
	{
		name: "ARS home: a changed currency books both legs again at the official type",
		seed: arsHome,
		base: base({ amount: "100", currency: "USD" }),
		edit: { currency: "EUR", amount: "50", rateType: "official" },
		expect: money({
			amount: "50",
			amountInUSD: "62.50",
			exchangeRate: "0.8",
			rateType: "official",
			homeCurrency: "ARS",
			homeRate: "1250",
			homeAmount: "62500.00",
		}),
	},
	// JPY home, USD 10.00 at 125 = 1250. USD 10.02 x 125 = 1252.5, a tie: half
	// to even is 1252 (half up would give 1253).
	{
		name: "JPY home: an edit to 1252.5 rounds to the even 1252",
		seed: jpy,
		base: base({ amount: "10.00", currency: "USD" }),
		edit: { amount: "10.02" },
		expect: money(official("JPY", "125", "10.02", "1252")),
	},
	// USD 10.06 x 125 = 1257.5, a tie: 1257 is odd, so 1258.
	{
		name: "JPY home: an edit to 1257.5 rounds to the even 1258",
		seed: jpy,
		base: base({ amount: "10.00", currency: "USD" }),
		edit: { amount: "10.06" },
		expect: money(official("JPY", "125", "10.06", "1258")),
	},
	// KWD home (0.25 per USD): USD 10.00 books 2.500. USD 10.01 x 0.25 =
	// 2.5025, a tie at 3 decimals: the even neighbor is 2.502.
	{
		name: "KWD home: an edit to 2.5025 rounds to the even 2.502",
		seed: kwd,
		base: base({ amount: "10.00", currency: "USD" }),
		edit: { amount: "10.01" },
		expect: money(official("KWD", "0.25", "10.01", "2.502")),
	},
	// USD 10.03 x 0.25 = 2.5075, a tie: 2.507 is odd, so 2.508.
	{
		name: "KWD home: an edit to 2.5075 rounds to the even 2.508",
		seed: kwd,
		base: base({ amount: "10.00", currency: "USD" }),
		edit: { amount: "10.03" },
		expect: money(official("KWD", "0.25", "10.03", "2.508")),
	},
	// Buenos Aires: 23:30 on Mar 31 local is 2026-04-01T02:30Z (March there,
	// UTC says April), booked at the 1600 row (after Apr 1 00:00Z): 100 x 1600
	// = 160000.00. 00:30 on Apr 1 local is 2026-04-01T03:30Z: the date edit
	// keeps 1600, and the expense leaves March for April.
	{
		name: "Buenos Aires: a date edit across midnight moves the expense from March to April",
		seed: baEdge,
		base: base({
			amount: "100",
			currency: "USD",
			date: at("2026-04-01T02:30:00Z"),
		}),
		edit: { date: at("2026-04-01T03:30:00Z") },
		expect: money({
			amount: "100",
			amountInUSD: "100",
			exchangeRate: "1",
			rateType: "blue",
			homeCurrency: "ARS",
			homeRate: "1600",
			homeAmount: "160000.00",
		}),
		months: {
			before: [march(true), april(false)],
			after: [march(false), april(true)],
		},
	},
	// A date edit alone keeps the booked rate: 07:00 on Mar 31 local is
	// 2026-03-31T10:00Z, where the table says 1500 (150000.00), but the
	// expense stays at the 1600 it was saved with. It stays in March.
	{
		name: "Buenos Aires: moving the date back does not rebook at the older rate",
		seed: baEdge,
		base: base({
			amount: "100",
			currency: "USD",
			date: at("2026-04-01T02:30:00Z"),
		}),
		edit: { date: at("2026-03-31T10:00:00Z") },
		expect: money({
			amount: "100",
			amountInUSD: "100",
			exchangeRate: "1",
			rateType: "blue",
			homeCurrency: "ARS",
			homeRate: "1600",
			homeAmount: "160000.00",
		}),
		months: {
			before: [march(true), april(false)],
			after: [march(true), april(false)],
		},
	},
	// Zero, and an amount that stores as 0 at 8 decimals: refused before any rate.
	{
		name: "refused: an edit to zero",
		seed: arsHome,
		base: base({ amount: "100", currency: "USD" }),
		edit: { amount: "0" },
		expect: { refused: AMOUNT_ABOVE_ZERO },
	},
	{
		name: "refused: an edit to an amount that stores as 0 at 8 decimals",
		seed: arsHome,
		base: base({ amount: "100", currency: "USD" }),
		edit: { amount: "0.000000004" },
		expect: { refused: AMOUNT_ABOVE_ZERO },
	},
	// CLP has no row in the table: the edit is blocked, never booked at 1.
	{
		name: "missing rate: an edit to a currency with no rate names it, row unchanged",
		seed: arsHome,
		base: base({ amount: "100", currency: "USD" }),
		edit: { currency: "CLP", amount: "5000" },
		expect: { missingRate: ["CLP"] },
	},
];
