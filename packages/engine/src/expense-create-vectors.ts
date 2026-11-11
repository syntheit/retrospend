/**
 * Vectors for expense create. Every expected value is derived by hand in the
 * comment above it, from these rules (createExpenseIn and bookRate):
 *
 * - Rates are units per USD. 1 EUR = (1 / EUR rate) USD, and a cross rate is
 *   the entry's USD value over the home currency's USD value.
 * - A rate type applies to both legs; a leg whose currency lacks the type
 *   falls back to its best rate. With no type the home's default applies
 *   (ARS: blue, otherwise the best: blue, official, crypto, then A to Z).
 * - homeRate is kept at 12 decimals; homeAmount is amount x exact rate,
 *   rounded half to even at the home currency's decimals (JPY 0, KWD 3).
 * - amountInUSD is the entry in USD rounded to cents; exchangeRate is the
 *   entry leg at 6 decimals (1 for USD).
 * - The rate is the newest row on or before the expense's instant (the
 *   earliest after it when none is before). It compares instants, not days.
 *
 * Rates and dates are in UTC; instants carry their zone in the comment.
 */
import type {
	CreateVector,
	ExpectedMoney,
	ExpenseSeed,
	RateSeed,
} from "./expense-create-conformance";

const at = (iso: string) => new Date(iso);
const rate = (
	currency: string,
	type: string,
	value: string,
	date: string,
): RateSeed => ({ currency, type, rate: value, date: at(date) });

const seed = (
	homeCurrency: string,
	timeZone: string,
	rates: RateSeed[],
	defaultRateTypes?: Record<string, string>,
): ExpenseSeed => ({
	homeCurrency,
	timeZone,
	rates,
	...(defaultRateTypes ? { defaultRateTypes } : {}),
});

const D = "2026-03-05T00:00:00Z";
const WHEN = at("2026-03-05T15:00:00Z");
const BA = "America/Argentina/Buenos_Aires";

/** ARS home: blue 1545 and official 1000 per USD, EUR official 0.8 per USD. */
const arsRates = [
	rate("ARS", "blue", "1545", D),
	rate("ARS", "official", "1000", D),
	rate("EUR", "official", "0.8", D),
];
const arsHome = seed("ARS", BA, arsRates);

const entry = (
	over: Partial<CreateVector["input"]> & { amount: string; currency: string },
): CreateVector["input"] => ({
	id: "e1",
	title: "Lunch",
	date: WHEN,
	...over,
});

const money = (m: ExpectedMoney) => ({ booked: m });

/** An expense 23:30 or 00:30 local at a month's edge, with the months it is checked against. */
const edge = (
	name: string,
	home: ExpenseSeed,
	instant: string,
	expected: ExpectedMoney,
	months: CreateVector["months"],
): CreateVector => ({
	name,
	seed: home,
	input: entry({ amount: "100", currency: "USD", date: at(instant) }),
	expect: money(expected),
	months,
});

export const vectors: CreateVector[] = [
	// USD 100, no type: the default for an ARS home is blue. USD leg 1, ARS
	// blue 1545, so homeRate = (1 / 1) / (1 / 1545) = 1545 and homeAmount =
	// 100 x 1545 = 154500.00. Both legs used blue or none (USD): label blue.
	{
		name: "ARS home: USD books the blue rate, home amount 154500.00",
		seed: arsHome,
		input: entry({ amount: "100", currency: "USD" }),
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
	// ARS 1000.50 in an ARS home: the entry leg is blue 1545, the home leg is
	// the same currency, so homeRate 1 and homeAmount 1000.50. USD value =
	// 1000.50 / 1545 = 0.64757..., to cents 0.65.
	{
		name: "ARS home: an ARS expense keeps its amount and prices in USD at blue",
		seed: arsHome,
		input: entry({ amount: "1000.50", currency: "ARS" }),
		expect: money({
			amount: "1000.50",
			amountInUSD: "0.65",
			exchangeRate: "1545",
			rateType: "blue",
			homeCurrency: "ARS",
			homeRate: "1",
			homeAmount: "1000.50",
		}),
	},
	// EUR 50, official picked: EUR 0.8 per USD gives 1.25 USD per EUR, ARS
	// official 1000 gives 0.001 USD per ARS. homeRate = 1.25 / 0.001 = 1250,
	// homeAmount = 50 x 1250 = 62500.00, USD value = 50 x 1.25 = 62.50.
	{
		name: "ARS home: EUR at the official type on both legs",
		seed: arsHome,
		input: entry({ amount: "50", currency: "EUR", rateType: "official" }),
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
	// EUR 50, no type: the default is blue. EUR has no blue row, so its leg
	// falls back to official 0.8; the home leg is ARS blue 1545. homeRate =
	// 1.25 x 1545 = 1931.25, homeAmount = 50 x 1931.25 = 96562.50. The home
	// leg used blue, so the label is blue.
	{
		name: "ARS home: EUR falls back to official on its leg, blue on the home leg",
		seed: arsHome,
		input: entry({ amount: "50", currency: "EUR" }),
		expect: money({
			amount: "50",
			amountInUSD: "62.50",
			exchangeRate: "0.8",
			rateType: "blue",
			homeCurrency: "ARS",
			homeRate: "1931.25",
			homeAmount: "96562.50",
		}),
	},
	// ARS blue rows 1545 (Mar 5), 1600 (Mar 8), 1700 (Mar 12); expense Mar 10
	// 12:00Z. The newest on or before is 1600: homeAmount = 10 x 1600 = 16000.
	{
		name: "ARS home: the newest rate on or before the date, not a later one",
		seed: seed("ARS", BA, [
			rate("ARS", "blue", "1545", "2026-03-05T00:00:00Z"),
			rate("ARS", "blue", "1600", "2026-03-08T00:00:00Z"),
			rate("ARS", "blue", "1700", "2026-03-12T00:00:00Z"),
		]),
		input: entry({
			amount: "10",
			currency: "USD",
			date: at("2026-03-10T12:00:00Z"),
		}),
		expect: money({
			amount: "10",
			amountInUSD: "10",
			exchangeRate: "1",
			rateType: "blue",
			homeCurrency: "ARS",
			homeRate: "1600",
			homeAmount: "16000.00",
		}),
	},
	// The only ARS blue row is Mar 20, after the Mar 5 expense: with none
	// before, the nearest later one is used. 10 x 1545 = 15450.
	{
		name: "ARS home: with no earlier rate the nearest later one is used",
		seed: seed("ARS", BA, [rate("ARS", "blue", "1545", "2026-03-20T00:00:00Z")]),
		input: entry({ amount: "10", currency: "USD" }),
		expect: money({
			amount: "10",
			amountInUSD: "10",
			exchangeRate: "1",
			rateType: "blue",
			homeCurrency: "ARS",
			homeRate: "1545",
			homeAmount: "15450.00",
		}),
	},
	// The user's saved default for ARS is official, so the home leg is ARS
	// official 1000: homeAmount = 10 x 1000 = 10000.
	{
		name: "ARS home: a saved default type replaces the built-in blue",
		seed: seed("ARS", BA, arsRates, { ARS: "official" }),
		input: entry({ amount: "10", currency: "USD" }),
		expect: money({
			amount: "10",
			amountInUSD: "10",
			exchangeRate: "1",
			rateType: "official",
			homeCurrency: "ARS",
			homeRate: "1000",
			homeAmount: "10000.00",
		}),
	},
	// Typed rate, 1 USD = 1234.5 ARS: homeRate 1234.5, homeAmount = 10 x
	// 1234.5 = 12345.00. The entry is USD, so its leg is 1 and USD value 10.
	{
		name: "ARS home: a typed rate books custom, home amount 12345.00",
		seed: arsHome,
		input: entry({
			amount: "10",
			currency: "USD",
			customRate: { base: "USD", value: "1234.5" },
		}),
		expect: money({
			amount: "10",
			amountInUSD: "10",
			exchangeRate: "1",
			rateType: "custom",
			homeCurrency: "ARS",
			homeRate: "1234.5",
			homeAmount: "12345.00",
		}),
	},
	// Typed 1 EUR = 1500 ARS, EUR 1030. homeAmount = 1030 x 1500 = 1545000.
	// The entry leg comes through the home leg (ARS blue 1545): 1 EUR =
	// 1500 / 1545 USD, so EUR per USD = 1545 / 1500 = 1.03 (6 decimals) and
	// the USD value of EUR 1030 is 1030 / 1.03 = 1000.
	{
		name: "ARS home: a typed EUR rate derives the entry leg through blue",
		seed: arsHome,
		input: entry({
			amount: "1030",
			currency: "EUR",
			customRate: { base: "EUR", value: "1500" },
		}),
		expect: money({
			amount: "1030",
			amountInUSD: "1000",
			exchangeRate: "1.03",
			rateType: "custom",
			homeCurrency: "ARS",
			homeRate: "1500",
			homeAmount: "1545000.00",
		}),
	},
	// The custom type with its entry leg typed: EUR 0.5 per USD is 2 USD per
	// EUR. The home leg is the default, ARS blue 1545: homeRate = 2 x 1545 =
	// 3090, homeAmount = 100 x 3090 = 309000, USD value = 100 x 2 = 200.
	{
		name: "ARS home: the custom type keeps the typed entry leg",
		seed: arsHome,
		input: entry({
			amount: "100",
			currency: "EUR",
			rateType: "custom",
			exchangeRate: 0.5,
		}),
		expect: money({
			amount: "100",
			amountInUSD: "200",
			exchangeRate: "0.5",
			rateType: "custom",
			homeCurrency: "ARS",
			homeRate: "3090",
			homeAmount: "309000.00",
		}),
	},

	// Refunds are negative amounts, booked sign-symmetrically.
	// USD -20: homeAmount = -20 x 1545 = -30900.00, USD value -20.
	{
		name: "refund: a negative USD amount books negative on every leg",
		seed: arsHome,
		input: entry({ amount: "-20", currency: "USD" }),
		expect: money({
			amount: "-20",
			amountInUSD: "-20",
			exchangeRate: "1",
			rateType: "blue",
			homeCurrency: "ARS",
			homeRate: "1545",
			homeAmount: "-30900.00",
		}),
	},
	// ARS -1000.50: homeRate 1, homeAmount -1000.50. USD value =
	// -1000.50 / 1545 = -0.64757..., to cents -0.65 (sign kept).
	{
		name: "refund: a negative ARS amount keeps its sign through the USD rounding",
		seed: arsHome,
		input: entry({ amount: "-1000.50", currency: "ARS" }),
		expect: money({
			amount: "-1000.50",
			amountInUSD: "-0.65",
			exchangeRate: "1545",
			rateType: "blue",
			homeCurrency: "ARS",
			homeRate: "1",
			homeAmount: "-1000.50",
		}),
	},

	// JPY has no decimals. JPY 1000 in a JPY home: entry leg official 125, so
	// USD value = 1000 / 125 = 8.00, homeRate 1, homeAmount 1000 (no decimals).
	{
		name: "JPY home: an amount with no decimals stays whole",
		seed: seed("JPY", "Asia/Tokyo", [rate("JPY", "official", "125", D)]),
		input: entry({ amount: "1000", currency: "JPY" }),
		expect: money({
			amount: "1000",
			amountInUSD: "8",
			exchangeRate: "125",
			rateType: "official",
			homeCurrency: "JPY",
			homeRate: "1",
			homeAmount: "1000",
		}),
	},
	// USD 10.06 at 125 JPY per USD = 1257.5 exactly, a tie: half to even
	// picks 1258 (1257 is odd).
	{
		name: "JPY home: a tie at 1257.5 rounds to the even 1258",
		seed: seed("JPY", "Asia/Tokyo", [rate("JPY", "official", "125", D)]),
		input: entry({ amount: "10.06", currency: "USD" }),
		expect: money({
			amount: "10.06",
			amountInUSD: "10.06",
			exchangeRate: "1",
			rateType: "official",
			homeCurrency: "JPY",
			homeRate: "125",
			homeAmount: "1258",
		}),
	},
	// USD 10.02 x 125 = 1252.5, a tie: the even neighbor is 1252.
	{
		name: "JPY home: a tie at 1252.5 rounds to the even 1252",
		seed: seed("JPY", "Asia/Tokyo", [rate("JPY", "official", "125", D)]),
		input: entry({ amount: "10.02", currency: "USD" }),
		expect: money({
			amount: "10.02",
			amountInUSD: "10.02",
			exchangeRate: "1",
			rateType: "official",
			homeCurrency: "JPY",
			homeRate: "125",
			homeAmount: "1252",
		}),
	},
	// Refunds tie the same way, mirrored: -1252.5 -> -1252, -1257.5 -> -1258.
	{
		name: "JPY home: a refund tie at -1252.5 rounds to -1252",
		seed: seed("JPY", "Asia/Tokyo", [rate("JPY", "official", "125", D)]),
		input: entry({ amount: "-10.02", currency: "USD" }),
		expect: money({
			amount: "-10.02",
			amountInUSD: "-10.02",
			exchangeRate: "1",
			rateType: "official",
			homeCurrency: "JPY",
			homeRate: "125",
			homeAmount: "-1252",
		}),
	},
	{
		name: "JPY home: a refund tie at -1257.5 rounds to -1258",
		seed: seed("JPY", "Asia/Tokyo", [rate("JPY", "official", "125", D)]),
		input: entry({ amount: "-10.06", currency: "USD" }),
		expect: money({
			amount: "-10.06",
			amountInUSD: "-10.06",
			exchangeRate: "1",
			rateType: "official",
			homeCurrency: "JPY",
			homeRate: "125",
			homeAmount: "-1258",
		}),
	},

	// KWD has 3 decimals. KWD 0.25 per USD gives 4 USD per KWD, so a USD
	// entry has homeRate 1 / 4 = 0.25. USD 10.01 x 0.25 = 2.5025, a tie at 3
	// decimals: the even neighbor of 2.502 and 2.503 is 2.502.
	{
		name: "KWD home: a tie at 2.5025 rounds to the even 2.502",
		seed: seed("KWD", "Asia/Kuwait", [rate("KWD", "official", "0.25", D)]),
		input: entry({ amount: "10.01", currency: "USD" }),
		expect: money({
			amount: "10.01",
			amountInUSD: "10.01",
			exchangeRate: "1",
			rateType: "official",
			homeCurrency: "KWD",
			homeRate: "0.25",
			homeAmount: "2.502",
		}),
	},
	// USD 10.03 x 0.25 = 2.5075, a tie: 2.507 is odd, so 2.508.
	{
		name: "KWD home: a tie at 2.5075 rounds to the even 2.508",
		seed: seed("KWD", "Asia/Kuwait", [rate("KWD", "official", "0.25", D)]),
		input: entry({ amount: "10.03", currency: "USD" }),
		expect: money({
			amount: "10.03",
			amountInUSD: "10.03",
			exchangeRate: "1",
			rateType: "official",
			homeCurrency: "KWD",
			homeRate: "0.25",
			homeAmount: "2.508",
		}),
	},
	// KWD 12.345 in a KWD home keeps all 3 decimals. USD value = 12.345 x 4 =
	// 49.38.
	{
		name: "KWD home: a KWD amount keeps its 3 decimals",
		seed: seed("KWD", "Asia/Kuwait", [rate("KWD", "official", "0.25", D)]),
		input: entry({ amount: "12.345", currency: "KWD" }),
		expect: money({
			amount: "12.345",
			amountInUSD: "49.38",
			exchangeRate: "0.25",
			rateType: "official",
			homeCurrency: "KWD",
			homeRate: "1",
			homeAmount: "12.345",
		}),
	},
	// EUR 10 into KWD: 1.25 USD per EUR over 4 USD per KWD = 0.3125 KWD per
	// EUR, homeAmount = 10 x 0.3125 = 3.125, USD value = 12.50.
	{
		name: "KWD home: EUR converts through USD to 3 decimals",
		seed: seed("KWD", "Asia/Kuwait", [
			rate("KWD", "official", "0.25", D),
			rate("EUR", "official", "0.8", D),
		]),
		input: entry({ amount: "10", currency: "EUR" }),
		expect: money({
			amount: "10",
			amountInUSD: "12.50",
			exchangeRate: "0.8",
			rateType: "official",
			homeCurrency: "KWD",
			homeRate: "0.3125",
			homeAmount: "3.125",
		}),
	},
	// No rate is needed when everything is USD: legs 1, no type.
	{
		name: "USD home: a USD expense needs no rate table",
		seed: seed("USD", "America/New_York", []),
		input: entry({ amount: "12.34", currency: "USD" }),
		expect: money({
			amount: "12.34",
			amountInUSD: "12.34",
			exchangeRate: "1",
			rateType: null,
			homeCurrency: "USD",
			homeRate: "1",
			homeAmount: "12.34",
		}),
	},

	// Month and time-zone edges. Buenos Aires is UTC-3 all year. Its March is
	// 2026-03-01T03:00Z to 2026-04-01T02:59:59.999Z, its April starts at
	// 2026-04-01T03:00Z. 23:30 on Mar 31 local is 2026-04-01T02:30Z: March
	// there, though UTC already says April. Rate rows are compared with the
	// instant, so the Apr 1 00:00Z row (1600) beats the Mar 31 one (1500):
	// homeAmount = 100 x 1600 = 160000.
	edge(
		"Buenos Aires: 23:30 on the last day of March counts in March",
		seed("ARS", BA, [
			rate("ARS", "blue", "1500", "2026-03-31T00:00:00Z"),
			rate("ARS", "blue", "1600", "2026-04-01T00:00:00Z"),
		]),
		"2026-04-01T02:30:00Z",
		{
			amount: "100",
			amountInUSD: "100",
			exchangeRate: "1",
			rateType: "blue",
			homeCurrency: "ARS",
			homeRate: "1600",
			homeAmount: "160000.00",
		},
		[
			{
				year: 2026,
				month: 2,
				start: "2026-03-01T03:00:00.000Z",
				end: "2026-04-01T02:59:59.999Z",
				counts: true,
			},
			{
				year: 2026,
				month: 3,
				start: "2026-04-01T03:00:00.000Z",
				end: "2026-05-01T02:59:59.999Z",
				counts: false,
			},
		],
	),
	// 00:30 on Apr 1 local is 2026-04-01T03:30Z, after April's start.
	edge(
		"Buenos Aires: 00:30 on the first of April counts in April",
		seed("ARS", BA, [
			rate("ARS", "blue", "1500", "2026-03-31T00:00:00Z"),
			rate("ARS", "blue", "1600", "2026-04-01T00:00:00Z"),
		]),
		"2026-04-01T03:30:00Z",
		{
			amount: "100",
			amountInUSD: "100",
			exchangeRate: "1",
			rateType: "blue",
			homeCurrency: "ARS",
			homeRate: "1600",
			homeAmount: "160000.00",
		},
		[
			{
				year: 2026,
				month: 2,
				start: "2026-03-01T03:00:00.000Z",
				end: "2026-04-01T02:59:59.999Z",
				counts: false,
			},
			{
				year: 2026,
				month: 3,
				start: "2026-04-01T03:00:00.000Z",
				end: "2026-05-01T02:59:59.999Z",
				counts: true,
			},
		],
	),
	// Tokyo is UTC+9. Its March is 2026-02-28T15:00Z to 2026-03-31T14:59:59.999Z.
	// 23:30 on Mar 31 local is 2026-03-31T14:30Z: March. USD 100 at 150 JPY
	// per USD: homeAmount = 100 x 150 = 15000.
	edge(
		"Tokyo: 23:30 on the last day of March counts in March",
		seed("JPY", "Asia/Tokyo", [
			rate("JPY", "official", "150", "2026-03-31T00:00:00Z"),
		]),
		"2026-03-31T14:30:00Z",
		{
			amount: "100",
			amountInUSD: "100",
			exchangeRate: "1",
			rateType: "official",
			homeCurrency: "JPY",
			homeRate: "150",
			homeAmount: "15000",
		},
		[
			{
				year: 2026,
				month: 2,
				start: "2026-02-28T15:00:00.000Z",
				end: "2026-03-31T14:59:59.999Z",
				counts: true,
			},
			{
				year: 2026,
				month: 3,
				start: "2026-03-31T15:00:00.000Z",
				end: "2026-04-30T14:59:59.999Z",
				counts: false,
			},
		],
	),
	// 00:30 on Apr 1 local is 2026-03-31T15:30Z: April in Tokyo, though UTC
	// still says March 31.
	edge(
		"Tokyo: 00:30 on the first of April counts in April",
		seed("JPY", "Asia/Tokyo", [
			rate("JPY", "official", "150", "2026-03-31T00:00:00Z"),
		]),
		"2026-03-31T15:30:00Z",
		{
			amount: "100",
			amountInUSD: "100",
			exchangeRate: "1",
			rateType: "official",
			homeCurrency: "JPY",
			homeRate: "150",
			homeAmount: "15000",
		},
		[
			{
				year: 2026,
				month: 2,
				start: "2026-02-28T15:00:00.000Z",
				end: "2026-03-31T14:59:59.999Z",
				counts: false,
			},
			{
				year: 2026,
				month: 3,
				start: "2026-03-31T15:00:00.000Z",
				end: "2026-04-30T14:59:59.999Z",
				counts: true,
			},
		],
	),

	// A missing rate blocks the save. Nothing is stored and no rate is 1.
	{
		name: "missing rate: a currency with no rows names itself",
		seed: seed("ARS", BA, [
			rate("ARS", "blue", "1545", D),
			rate("ARS", "official", "1000", D),
		]),
		input: entry({ amount: "50", currency: "EUR" }),
		expect: { missingRate: ["EUR"] },
	},
	{
		name: "missing rate: a USD expense in a home with no rows names the home",
		seed: seed("ARS", BA, [rate("EUR", "official", "0.8", D)]),
		input: entry({ amount: "10", currency: "USD" }),
		expect: { missingRate: ["ARS"] },
	},
	{
		name: "missing rate: an expense in the home currency still needs its rate",
		seed: seed("ARS", BA, []),
		input: entry({ amount: "1000", currency: "ARS" }),
		expect: { missingRate: ["ARS"] },
	},
	{
		name: "missing rate: a zero rate row is not a rate",
		seed: seed("ARS", BA, [rate("ARS", "blue", "0", D)]),
		input: entry({ amount: "10", currency: "USD" }),
		expect: { missingRate: ["ARS"] },
	},
];
