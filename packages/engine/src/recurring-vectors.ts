/**
 * Vectors for recurring confirm, skip and the poster. A "poster" step plans
 * the run with the domain (`planPosterRun`) and books each planned period with
 * one confirm. Every expected value is
 * derived by hand in the comment above it, from the rules the server runs
 * (slice-device-recurring.md, test plan):
 *
 * - Home ARS, preferred type blue (1 USD = 1,545 ARS blue, 1,050 official),
 *   saved zone Buenos Aires (UTC-3, no DST): its midnight is 03:00Z all year.
 *   The base template is a monthly USD 20 on the 1st, due 2026-12-01T03:00Z.
 * - A post books the due date's rate (the newest row on or before the due
 *   instant) at the preferred type, both legs at once: ARS 20 x 1545 =
 *   30,900.00 (official would give 21,000.00), amountInUSD 20.
 * - An expense is due while its due instant is before the start of the next
 *   day in the zone the check reads (the request's zone, the saved zone for
 *   the poster). Auto posting adds the instant gate: due on or before now.
 * - Due dates step in the saved zone, whatever zone the phone is in.
 * - homeAmount is amount x homeRate rounded half to even at the home
 *   currency's decimals (ARS 2, JPY 0).
 *
 * `tz` is the zone the test process runs under (process.env.TZ). It is never
 * the saved zone, so a post that read the phone's own zone would give another
 * answer than the vector says.
 */
import type { PosterStop } from "@retrospend/domain/recurring-post/poster";
import type { RateSeed } from "./expense-create-conformance";
import { at, BA, rate } from "./expense-create-vectors";

export const TOKYO = "Asia/Tokyo";
export const UTC = "UTC";

export interface RecurringSeed {
	homeCurrency: string;
	/** The saved zone. */
	timeZone: string;
	rates: RateSeed[];
	template: {
		amount: string;
		currency: string;
		frequency: "WEEKLY" | "MONTHLY";
		nextDueDate: Date;
		anchorDay: number | null;
		amountMode?: "FIXED" | "ASK";
		autoPay?: boolean;
		isActive?: boolean;
	};
}

/** The fields of a posted expense a vector derives by hand. Decimals are text, compared by value. */
export interface ExpectedPost {
	date: string;
	amount: string;
	amountInUSD: string;
	homeRate: string;
	homeAmount: string;
	rateType: string;
}

export type RecurringStep = {
	call: "confirm" | "skip" | "poster";
	now: Date;
	/**
	 * A pull ran before this step. A poster plans from the template as last
	 * pulled, and a local write clears its version, so a second run needs one.
	 */
	afterPull?: true;
	/** The request zone of a manual confirm; the saved zone when absent. */
	zone?: string;
	paidOn?: string;
	confirmedAmount?: string;
	/** A confirm of this due date; the template's own when absent. */
	dueAt?: Date;
	expect:
		| {
				posted: ExpectedPost[];
				/** The template's due date after the step. */
				nextDueDate: string;
				stopped?: PosterStop;
				refusal?: string;
		  }
		| {
				/** How many were posted, and their home amounts added. */
				count: number;
				homeTotal: string;
				nextDueDate: string;
				stopped: PosterStop;
		  }
		/** A refusal of the core: RecurringRefusal or input kind. The template is unchanged. */
		| { refused: string }
		| { missingRate: string[] };
};

export interface RecurringVector {
	name: string;
	seed: RecurringSeed;
	/** The process zone the steps run under. */
	tz: string;
	steps: RecurringStep[];
}

const D = (iso: string) => at(iso);

/** Blue 1545 from Nov 30, official 1050 from Dec 1: a post that ignores the type or the day reads the wrong one. */
const baseRates: RateSeed[] = [
	rate("ARS", "blue", "1540", "2026-11-29T00:00:00Z"),
	rate("ARS", "blue", "1545", "2026-11-30T00:00:00Z"),
	rate("ARS", "official", "1050", "2026-12-01T00:00:00Z"),
];

const monthly = {
	amount: "20",
	currency: "USD",
	frequency: "MONTHLY",
	nextDueDate: D("2026-12-01T03:00:00Z"),
	anchorDay: 1,
} as const;

const baseSeed: RecurringSeed = {
	homeCurrency: "ARS",
	timeZone: BA,
	rates: baseRates,
	template: monthly,
};

/** The base post: ARS 30,900.00 on the due instant, then the next first of the month. */
const BASE_POST: ExpectedPost = {
	date: "2026-12-01T03:00:00.000Z",
	amount: "20",
	amountInUSD: "20",
	homeRate: "1545",
	homeAmount: "30900.00",
	rateType: "blue",
};
const NEXT_BA = "2027-01-01T03:00:00.000Z";
const DEC_1 = D("2026-12-01T03:00:00Z");

const base = (over: Partial<RecurringVector> = {}): RecurringVector => ({
	name: "",
	seed: baseSeed,
	tz: "Pacific/Auckland",
	steps: [],
	...over,
});

const withTemplate = (
	over: Partial<RecurringSeed["template"]>,
	rates: RateSeed[] = baseRates,
	extra: Partial<RecurringSeed> = {},
): RecurringSeed => ({
	...baseSeed,
	rates,
	...extra,
	template: { ...monthly, ...over },
});

/** The step that leaves the template where it was: nothing due. */
const idle = (now: string, nextDueDate: string): RecurringStep => ({
	call: "poster",
	now: D(now),
	expect: { posted: [], nextDueDate, stopped: "caught_up" },
});

const wasDue = "2026-12-01T03:00:00.000Z";

/** Weekly USD 20 on Wednesdays from Jan 7, blue 1545 all year. */
const weekly = withTemplate(
	{
		frequency: "WEEKLY",
		anchorDay: null,
		nextDueDate: D("2026-01-07T03:00:00Z"),
	},
	[rate("ARS", "blue", "1545", "2026-01-01T00:00:00Z")],
);

const refusedAt = (
	name: string,
	seed: RecurringSeed,
	step: Omit<RecurringStep, "expect" | "call" | "now"> & { now?: Date },
	refused: string,
): RecurringVector =>
	base({
		name,
		seed,
		steps: [
			{
				call: "confirm",
				now: DEC_1,
				...step,
				expect: { refused },
			},
		],
	});

export const recurringVectors: RecurringVector[] = [
	// Due 03:00Z is Dec 1 00:00 in Buenos Aires. Blue 1545 is the newest blue
	// row on or before it: 20 x 1545 = 30,900.00. Stepping from the 1st, anchor 1,
	// in Buenos Aires gives Jan 1 00:00 = 03:00Z. The process runs in Auckland.
	base({
		name: "base case: USD 20 books ARS 30,900.00 at blue and steps to Jan 1",
		steps: [
			{
				call: "confirm",
				now: DEC_1,
				expect: { posted: [BASE_POST], nextDueDate: NEXT_BA },
			},
		],
	}),
	// A device whose own zone is UTC at 02:00Z: it is Nov 30 23:00 in Buenos
	// Aires, so the period is not due (a read of the phone's UTC day would
	// post). At 03:00Z it posts the base row. The poster's instant gate says
	// the same: nothing at 02:00Z.
	base({
		name: "UTC device: a 03:00Z due date does not post at 02:00Z, posts at 03:00Z",
		tz: UTC,
		steps: [
			{
				call: "confirm",
				now: D("2026-12-01T02:00:00Z"),
				expect: { refused: "not_due" },
			},
			idle("2026-12-01T02:00:00Z", wasDue),
			{
				call: "confirm",
				now: DEC_1,
				expect: { posted: [BASE_POST], nextDueDate: NEXT_BA },
			},
		],
	}),
	// A device in Tokyo at 2026-11-30T16:00Z: Dec 1 01:00 there, Nov 30 13:00
	// in Buenos Aires. Not due. At 03:00Z it posts the same row, the same date
	// and the same next due date.
	base({
		name: "Tokyo device: nothing at 16:00Z the day before, the base row at 03:00Z",
		tz: TOKYO,
		steps: [
			{
				call: "confirm",
				now: D("2026-11-30T16:00:00Z"),
				expect: { refused: "not_due" },
			},
			idle("2026-11-30T16:00:00Z", wasDue),
			{
				call: "confirm",
				now: DEC_1,
				expect: { posted: [BASE_POST], nextDueDate: NEXT_BA },
			},
		],
	}),
	// The saved zone moved to Tokyo. The stored due instant stays 03:00Z (Dec 1
	// 12:00 in Tokyo). The poster's instant gate: nothing at 2026-11-30T15:30Z,
	// a post at 03:00Z. Stepping in Tokyo: the 1st at 00:00 Tokyo is
	// 2026-12-31T15:00Z (stepping in Buenos Aires would give 2027-01-01T03:00Z).
	base({
		name: "saved zone Tokyo: the poster waits for the instant and steps to 2026-12-31T15:00Z",
		seed: { ...baseSeed, timeZone: TOKYO },
		steps: [
			idle("2026-11-30T15:30:00Z", wasDue),
			{
				call: "poster",
				now: DEC_1,
				expect: {
					posted: [BASE_POST],
					nextDueDate: "2026-12-31T15:00:00.000Z",
					stopped: "caught_up",
				},
			},
		],
	}),
	// A manual confirm reads "is it due" in the request's zone. At
	// 2026-11-30T15:30Z it is Dec 1 00:30 in Tokyo, so the start of the next
	// day is Dec 2 00:00 Tokyo (Dec 1 15:00Z), after the due instant: due. The
	// same call in Buenos Aires (Nov 30 12:30) is not due.
	base({
		name: "saved zone Tokyo: a manual confirm passes the check in Tokyo and not in Buenos Aires",
		seed: { ...baseSeed, timeZone: TOKYO },
		steps: [
			{
				call: "confirm",
				now: D("2026-11-30T15:30:00Z"),
				zone: BA,
				expect: { refused: "not_due" },
			},
			{
				call: "confirm",
				now: D("2026-11-30T15:30:00Z"),
				expect: {
					posted: [BASE_POST],
					nextDueDate: "2026-12-31T15:00:00.000Z",
				},
			},
		],
	}),
	// Due Sep 1, Oct 1 and Nov 1 (03:00Z each), blue 1500, 1520, 1545 from the
	// day before each. One run books each at its own due date: 20 x 1500 =
	// 30,000.00, 20 x 1520 = 30,400.00, 20 x 1545 = 30,900.00; today's rate for
	// all three would give 92,700.00 instead of 91,300.00. Next: Dec 1.
	base({
		name: "the poster books each due date at its own rate",
		seed: withTemplate({ nextDueDate: D("2026-09-01T03:00:00Z") }, [
			rate("ARS", "blue", "1500", "2026-09-01T00:00:00Z"),
			rate("ARS", "blue", "1520", "2026-10-01T00:00:00Z"),
			rate("ARS", "blue", "1545", "2026-11-01T00:00:00Z"),
		]),
		steps: [
			{
				call: "poster",
				now: D("2026-11-15T12:00:00Z"),
				expect: {
					posted: [
						{
							...BASE_POST,
							date: "2026-09-01T03:00:00.000Z",
							homeRate: "1500",
							homeAmount: "30000.00",
						},
						{
							...BASE_POST,
							date: "2026-10-01T03:00:00.000Z",
							homeRate: "1520",
							homeAmount: "30400.00",
						},
						{
							...BASE_POST,
							date: "2026-11-01T03:00:00.000Z",
							homeRate: "1545",
							homeAmount: "30900.00",
						},
					],
					nextDueDate: wasDue,
					stopped: "caught_up",
				},
			},
		],
	}),
	// No ARS rate at all: a confirm is refused (never booked at 1), and a
	// the poster plans nothing and rests on the same due date.
	base({
		name: "missing rate: a confirm is refused and the poster plans nothing",
		seed: withTemplate({}, []),
		steps: [
			{ call: "confirm", now: DEC_1, expect: { missingRate: ["ARS"] } },
			{
				call: "poster",
				now: DEC_1,
				expect: {
					posted: [],
					nextDueDate: wasDue,
					stopped: "refused",
					refusal: "missing_rate",
				},
			},
		],
	}),
	// Weekly from Wed Jan 7, 7 days each: period k is Jan 7 + 7k days. Read at
	// Oct 10 12:00Z, k = 39 is Oct 7 (Jan 7 is day 7, + 273 = day 280 = Oct 7)
	// and k = 40 is Oct 14, so 40 are due. Run 1 posts 31 (k 0 to 30) at 1545:
	// 31 x 30,900.00 = 957,900.00, and rests on k = 31, Aug 12 (day 224).
	// Run 2, after a pull, posts the other 9: 278,100.00, resting on Oct 14.
	// Total 1,236,000.00.
	base({
		name: "cap: 40 weekly periods post as 31 and then 9",
		seed: weekly,
		steps: [
			{
				call: "poster",
				now: D("2026-10-10T12:00:00Z"),
				expect: {
					count: 31,
					homeTotal: "957900.00",
					nextDueDate: "2026-08-12T03:00:00.000Z",
					stopped: "cap",
				},
			},
			{
				call: "poster",
				now: D("2026-10-10T12:00:00Z"),
				afterPull: true,
				expect: {
					count: 9,
					homeTotal: "278100.00",
					nextDueDate: "2026-10-14T03:00:00.000Z",
					stopped: "caught_up",
				},
			},
		],
	}),
	// Anchor 31: Jan 31 2028 steps to Feb 29 (a leap year) and then back to
	// Mar 31, because the anchor stays 31. Each date is 00:00 in Buenos Aires.
	base({
		name: "day 31: Jan 31 2028 steps to Feb 29 then Mar 31",
		seed: withTemplate(
			{ anchorDay: 31, nextDueDate: D("2028-01-31T03:00:00Z") },
			[rate("ARS", "blue", "1545", "2028-01-01T00:00:00Z")],
		),
		steps: [
			{
				call: "confirm",
				now: D("2028-02-01T12:00:00Z"),
				expect: {
					posted: [{ ...BASE_POST, date: "2028-01-31T03:00:00.000Z" }],
					nextDueDate: "2028-02-29T03:00:00.000Z",
				},
			},
			{
				call: "confirm",
				now: D("2028-03-01T12:00:00Z"),
				expect: {
					posted: [{ ...BASE_POST, date: "2028-02-29T03:00:00.000Z" }],
					nextDueDate: "2028-03-31T03:00:00.000Z",
				},
			},
		],
	}),
	base({
		name: "day 31: Jan 31 2027 steps to Feb 28",
		seed: withTemplate(
			{ anchorDay: 31, nextDueDate: D("2027-01-31T03:00:00Z") },
			[rate("ARS", "blue", "1545", "2027-01-01T00:00:00Z")],
		),
		steps: [
			{
				call: "skip",
				now: D("2027-02-01T12:00:00Z"),
				expect: { posted: [], nextDueDate: "2027-02-28T03:00:00.000Z" },
			},
		],
	}),
	// Dec 1 period paid on Nov 29: the entry is dated Nov 29 00:00 BA (03:00Z)
	// and books that day's blue, 1540: 20 x 1540 = 30,800.00. The template
	// still steps from the due date, to Jan 1.
	base({
		name: "paid on an earlier day books that day's rate and steps from the due date",
		steps: [
			{
				call: "confirm",
				now: DEC_1,
				paidOn: "2026-11-29",
				expect: {
					posted: [
						{
							...BASE_POST,
							date: "2026-11-29T03:00:00.000Z",
							homeRate: "1540",
							homeAmount: "30800.00",
						},
					],
					nextDueDate: NEXT_BA,
				},
			},
		],
	}),
	// An amount that varies never posts on its own (the poster is refused at
	// the template). A manual confirm of USD 18.50: 18.5 x 1545 = 28,582.50.
	base({
		name: "ASK: the poster posts nothing and a manual confirm books the typed amount",
		seed: withTemplate({ amountMode: "ASK" }),
		steps: [
			{
				call: "poster",
				now: DEC_1,
				expect: {
					posted: [],
					nextDueDate: wasDue,
					stopped: "refused",
					refusal: "not_found",
				},
			},
			{
				call: "confirm",
				now: DEC_1,
				confirmedAmount: "18.50",
				expect: {
					posted: [
						{
							...BASE_POST,
							amount: "18.5",
							amountInUSD: "18.5",
							homeAmount: "28582.50",
						},
					],
					nextDueDate: NEXT_BA,
				},
			},
		],
	}),
	// EUR home, EUR 0.92 per USD: USD 20 = EUR 20 x 0.92 = 18.40. The template
	// is due Dec 1 00:00 UTC (zone UTC).
	base({
		name: "EUR home: USD 20 at 0.92 books EUR 18.40",
		seed: withTemplate(
			{ nextDueDate: D("2026-12-01T00:00:00Z") },
			[rate("EUR", "official", "0.92", "2026-11-30T00:00:00Z")],
			{ homeCurrency: "EUR", timeZone: UTC },
		),
		steps: [
			{
				call: "confirm",
				now: D("2026-12-01T00:00:00Z"),
				expect: {
					posted: [
						{
							...BASE_POST,
							date: "2026-12-01T00:00:00.000Z",
							homeRate: "0.92",
							homeAmount: "18.40",
							rateType: "official",
						},
					],
					nextDueDate: "2027-01-01T00:00:00.000Z",
				},
			},
		],
	}),
	// JPY home, JPY 150 per USD, USD 8.35: 8.35 x 150 = 1,252.5, a tie, which
	// half to even takes to 1,252 (half up would give 1,253). JPY has no decimals.
	base({
		name: "JPY home: USD 8.35 at 150 books JPY 1,252 (half to even)",
		seed: withTemplate(
			{ amount: "8.35", nextDueDate: D("2026-12-01T00:00:00Z") },
			[rate("JPY", "official", "150", "2026-11-30T00:00:00Z")],
			{ homeCurrency: "JPY", timeZone: UTC },
		),
		steps: [
			{
				call: "confirm",
				now: D("2026-12-01T00:00:00Z"),
				expect: {
					posted: [
						{
							date: "2026-12-01T00:00:00.000Z",
							amount: "8.35",
							amountInUSD: "8.35",
							homeRate: "150",
							homeAmount: "1252",
							rateType: "official",
						},
					],
					nextDueDate: "2027-01-01T00:00:00.000Z",
				},
			},
		],
	}),
	// Skip moves the due date and books nothing.
	base({
		name: "skip steps to Jan 1 and books nothing",
		steps: [
			{
				call: "skip",
				now: DEC_1,
				expect: { posted: [], nextDueDate: NEXT_BA },
			},
		],
	}),
	base({
		name: "a period posted twice: the second confirm of the same due date is already posted",
		steps: [
			{
				call: "confirm",
				now: DEC_1,
				dueAt: DEC_1,
				expect: { posted: [BASE_POST], nextDueDate: NEXT_BA },
			},
			{
				call: "confirm",
				now: DEC_1,
				dueAt: DEC_1,
				expect: { refused: "already_posted" },
			},
		],
	}),
	refusedAt(
		"a paused template is not found",
		withTemplate({ isActive: false }),
		{},
		"not_found",
	),
	refusedAt(
		"ASK without an amount is refused",
		withTemplate({ amountMode: "ASK" }),
		{},
		"amount_required",
	),
	refusedAt(
		"a fixed amount refuses a typed one",
		baseSeed,
		{ confirmedAmount: "25" },
		"amount_fixed",
	),
	refusedAt(
		"a paid-on day in the future is refused",
		baseSeed,
		{ paidOn: "2026-12-02" },
		"date_in_future",
	),
	// The previous due day of Dec 1 is Nov 1.
	refusedAt(
		"a paid-on day before the previous due day is refused",
		baseSeed,
		{ paidOn: "2026-10-31" },
		"date_before_previous_due",
	),
];
