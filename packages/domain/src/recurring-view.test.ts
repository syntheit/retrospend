/**
 * The Recurring view and its figures computed from templates held in memory
 * (the device loader), every expected value derived by hand. The pg
 * conformance test (src/server/services/figures/recurring-entry.pg.test.ts)
 * holds the SQL loader to the same inputs.
 *
 * "Now" is 2026-10-15 15:00 UTC, noon in Buenos Aires (UTC-3, no DST), so
 * today is Oct 15 there. Rates are units per USD: ARS 1,500 (blue), JPY 150,
 * KWD 0.3. A Buenos Aires due date is stored as local midnight, 03:00Z.
 */
import { describe, expect, it } from "vitest";
import type { RateRow } from "./money";
import {
	type RecurringInputs,
	type RecurringTemplateRow,
	recurringAmountOf,
	recurringBodyFrom,
	recurringCostOf,
	recurringInputsFromRows,
	recurringRateCurrencies,
	sortRecurringTemplates,
} from "./recurring-view";

const BA = "America/Argentina/Buenos_Aires";
const SCL = "America/Santiago";
const NOW = new Date("2026-10-15T15:00:00Z");
const ba = (day: string) => new Date(`${day}T03:00:00.000Z`);

const tpl = (
	o: Partial<RecurringTemplateRow> & { id: string },
): RecurringTemplateRow => ({
	name: o.id,
	amount: "100",
	currency: "ARS",
	frequency: "MONTHLY",
	nextDueDate: ba("2026-10-31"),
	anchorDay: null,
	direction: "OUT",
	isActive: true,
	autoPay: false,
	amountMode: "FIXED",
	category: null,
	...o,
});

const body = (
	inputs: RecurringInputs,
	zones: { timeZone?: string; stepZone?: string; now?: Date } = {},
) =>
	recurringBodyFrom({
		inputs,
		now: zones.now ?? NOW,
		timeZone: zones.timeZone ?? BA,
		stepZone: zones.stepZone ?? BA,
	});

const arsHome = (templates: RecurringTemplateRow[], extra = {}): RecurringInputs => ({
	home: "ARS",
	templates,
	rates: { ARS: 1500, JPY: 150, KWD: 0.3, ...extra },
});

describe("costs at today's rates, home ARS", () => {
	// Netflix USD 10 monthly: 10 x 1,500 = ARS 15,000.
	// Club ARS 2,000 weekly: 2,000 x 52 / 12 = 8,666.67 a month.
	// Gym JPY 3,000 monthly: 3,000 / 150 = USD 20 = ARS 30,000.
	// Dues KWD 12.345 monthly: 12.345 / 0.3 = USD 41.15 = ARS 61,725.
	// Out a month: 15,000 + 8,666.666667 + 30,000 + 61,725 = 115,391.666667,
	// ARS 115,391.67; a quarter 346,175; a year 1,384,700 (3 and 12 times the
	// unrounded month).
	const templates = [
		tpl({ id: "netflix", amount: "10", currency: "USD" }),
		tpl({ id: "club", amount: "2000", frequency: "WEEKLY" }),
		tpl({ id: "gym", amount: "3000", currency: "JPY" }),
		tpl({ id: "dues", amount: "12.345", currency: "KWD" }),
		// A paused template is listed and stays out of the cost.
		tpl({ id: "paused", amount: "9999", isActive: false }),
		// Salary ARS 100,000 monthly in: 100,000, 300,000 and 1,200,000.
		tpl({ id: "salary", amount: "100000", direction: "IN" }),
	];
	const b = body(arsHome(templates));

	it("sums the active outgoing templates per period, rounding once", () => {
		expect(b.out).toEqual({
			month: { minor: 11_539_167, currency: "ARS" },
			quarter: { minor: 34_617_500, currency: "ARS" },
			year: { minor: 138_470_000, currency: "ARS" },
			missingRate: [],
		});
	});

	it("sums the active incoming templates apart", () => {
		expect(b.in).toEqual({
			month: { minor: 10_000_000, currency: "ARS" },
			quarter: { minor: 30_000_000, currency: "ARS" },
			year: { minor: 120_000_000, currency: "ARS" },
			missingRate: [],
		});
	});

	it("shows each amount in its own currency's minor units, JPY 0 and KWD 3 decimals", () => {
		const byId = Object.fromEntries(b.items.map((i) => [i.id, i]));
		expect(byId.netflix?.amount).toEqual({ minor: 1000, currency: "USD" });
		expect(byId.gym?.amount).toEqual({ minor: 3000, currency: "JPY" });
		expect(byId.dues?.amount).toEqual({ minor: 12_345, currency: "KWD" });
	});

	it("gives a foreign template its home value, and none to one already in the home currency", () => {
		const byId = Object.fromEntries(b.items.map((i) => [i.id, i]));
		expect(byId.netflix?.home).toEqual({ minor: 1_500_000, currency: "ARS" });
		expect(byId.gym?.home).toEqual({ minor: 3_000_000, currency: "ARS" });
		expect(byId.dues?.home).toEqual({ minor: 6_172_500, currency: "ARS" });
		expect(byId.club && "home" in byId.club).toBe(false);
	});

	it("keeps a paused template listed and out of the cost", () => {
		const paused = b.items.find((i) => i.id === "paused");
		expect(paused?.paused).toBe(true);
		expect(b.out.month.minor).toBe(11_539_167);
	});

	it("reads the figures from the body: amount by id, cost by direction and period", () => {
		expect(recurringAmountOf(b, "gym")).toEqual([
			{ minor: 3000, currency: "JPY" },
		]);
		expect(recurringAmountOf(b, "nope")).toEqual([]);
		expect(recurringCostOf(b, "out", "quarter")).toEqual([
			{ minor: 34_617_500, currency: "ARS" },
		]);
		expect(recurringCostOf(b, "in", "year")).toEqual([
			{ minor: 120_000_000, currency: "ARS" },
		]);
	});

	it("has no incoming cost when no active template brings money in", () => {
		const out = body(arsHome([tpl({ id: "a" })]));
		expect(out.in).toBeNull();
		expect(recurringCostOf(out, "in", "month")).toEqual([]);
	});
});

describe("other home currencies", () => {
	it("JPY home rounds to whole yen, half to even: KWD 12.345 is USD 41.15 is JPY 6,172.5, so 6,172", () => {
		const b = body({
			home: "JPY",
			templates: [tpl({ id: "dues", amount: "12.345", currency: "KWD" })],
			rates: { JPY: 150, KWD: 0.3 },
		});
		expect(b.items[0]?.home).toEqual({ minor: 6172, currency: "JPY" });
		// The cost rounds the month once, and the quarter from the unrounded
		// month: 6,172.5 x 3 = 18,517.5, which is also a tie, so 18,518 (even).
		expect(b.out.month).toEqual({ minor: 6172, currency: "JPY" });
		expect(b.out.quarter).toEqual({ minor: 18_518, currency: "JPY" });
		expect(b.out.year).toEqual({ minor: 74_070, currency: "JPY" });
	});

	it("KWD home keeps three decimals: USD 10 is KWD 3, ARS 1,500 is KWD 0.3", () => {
		const b = body({
			home: "KWD",
			templates: [
				tpl({ id: "a", amount: "10", currency: "USD" }),
				tpl({ id: "b", amount: "1500", currency: "ARS" }),
			],
			rates: { KWD: 0.3, ARS: 1500 },
		});
		expect(b.items.map((i) => i.home)).toEqual([
			{ minor: 3000, currency: "KWD" },
			{ minor: 300, currency: "KWD" },
		]);
		expect(b.out).toEqual({
			month: { minor: 3300, currency: "KWD" },
			quarter: { minor: 9900, currency: "KWD" },
			year: { minor: 39_600, currency: "KWD" },
			missingRate: [],
		});
	});

	it("USD home needs no rate for itself", () => {
		const b = body({
			home: "USD",
			templates: [tpl({ id: "a", amount: "15", currency: "USD" })],
			rates: {},
		});
		expect(b.out.month).toEqual({ minor: 1500, currency: "USD" });
		expect(b.out.missingRate).toEqual([]);
	});
});

describe("a missing rate is named and never 1, zero or NaN", () => {
	it("a currency with no rate makes the cost unavailable, naming it, and its home value null", () => {
		const b = body(
			arsHome(
				[
					tpl({ id: "ok", amount: "1000" }),
					tpl({ id: "token", amount: "10", currency: "XYZ" }),
				],
				{ XYZ: null },
			),
		);
		expect(b.items.find((i) => i.id === "token")?.home).toBeNull();
		expect(b.out.missingRate).toEqual(["XYZ"]);
		expect(recurringCostOf(b, "out", "month")).toEqual({
			unavailable: ["XYZ"],
		});
		// The rest still sums on the page's partial line: ARS 1,000.
		expect(b.out.month).toEqual({ minor: 100_000, currency: "ARS" });
	});

	it("a key absent from the rates is as missing as a null one", () => {
		const b = body(arsHome([tpl({ id: "t", currency: "XYZ" })]));
		expect(b.out.missingRate).toEqual(["XYZ"]);
	});

	it("a rate that is not a positive number is missing, not used", () => {
		for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
			const b = body(arsHome([tpl({ id: "t", currency: "XYZ" })], { XYZ: bad }));
			expect(b.out.missingRate).toEqual(["XYZ"]);
			expect(b.items[0]?.home).toBeNull();
		}
	});

	it("a home currency with no rate makes every foreign template rate-less and is named", () => {
		const b = body({
			home: "MVR",
			templates: [
				tpl({ id: "usd", amount: "10", currency: "USD" }),
				tpl({ id: "own", amount: "50", currency: "MVR" }),
			],
			rates: { MVR: null },
		});
		expect(b.out.missingRate).toEqual(["MVR"]);
		expect(b.items.find((i) => i.id === "usd")?.home).toBeNull();
		// A template already in the home currency needs no rate.
		expect(b.items.find((i) => i.id === "own" && "home" in i)).toBeUndefined();
		expect(b.out.month).toEqual({ minor: 5000, currency: "MVR" });
	});

	it("names both the template's currency and the home currency, sorted", () => {
		const b = body({
			home: "MVR",
			templates: [tpl({ id: "t", amount: "10", currency: "XYZ" })],
			rates: { MVR: null, XYZ: null },
		});
		expect(b.out.missingRate).toEqual(["MVR", "XYZ"]);
	});

	it("the incoming cost is unavailable on its own, leaving the outgoing one", () => {
		const b = body(
			arsHome(
				[
					tpl({ id: "rent", amount: "500" }),
					tpl({ id: "pay", amount: "10", currency: "XYZ", direction: "IN" }),
				],
				{ XYZ: null },
			),
		);
		expect(recurringCostOf(b, "out", "month")).toEqual([
			{ minor: 50_000, currency: "ARS" },
		]);
		expect(recurringCostOf(b, "in", "month")).toEqual({
			unavailable: ["XYZ"],
		});
	});
});

describe("due dates", () => {
	it("Buenos Aires, day 31 anchor: Oct 31 steps to Nov 30, and the previous due day is Sep 30", () => {
		const [t] = body(
			arsHome([tpl({ id: "rent", frequency: "MONTHLY", anchorDay: 31 })]),
		).items;
		expect(t).toMatchObject({
			next: "2026-10-31",
			dueAt: "2026-10-31T03:00:00.000Z",
			nextAfter: "2026-11-30",
			paidOnFrom: "2026-09-30",
			state: "upcoming",
		});
	});

	it("a day 31 anchor returns to Mar 31 after a short February", () => {
		const [t] = body(
			arsHome([
				tpl({ id: "rent", nextDueDate: ba("2027-02-28"), anchorDay: 31 }),
			]),
		).items;
		expect(t?.nextAfter).toBe("2027-03-31");
		expect(t?.paidOnFrom).toBe("2027-01-31");
	});

	it("without an anchor the date's own day in the zone steps, Jan 31 to Feb 28", () => {
		const [t] = body(
			arsHome([tpl({ id: "rent", nextDueDate: ba("2027-01-31") })]),
		).items;
		expect(t?.nextAfter).toBe("2027-02-28");
	});

	it("states: before today is overdue, today due, after upcoming (today is Oct 15 in Buenos Aires)", () => {
		const b = body(
			arsHome([
				tpl({ id: "a", nextDueDate: ba("2026-10-14") }),
				tpl({ id: "b", nextDueDate: ba("2026-10-15") }),
				tpl({ id: "c", nextDueDate: ba("2026-10-16") }),
			]),
		);
		expect(b.today).toBe("2026-10-15");
		expect(b.items.map((i) => i.state)).toEqual(["overdue", "due", "upcoming"]);
	});

	it("Santiago, where Sep 6 2026 has no midnight: weekly from Aug 30 lands on Sep 6, and from the 01:00 instant on Sep 13", () => {
		// Aug 30 midnight is 04:00Z (UTC-4); on Sep 6 the clock jumps from 00:00
		// to 01:00 (UTC-3), so that day starts at 04:00Z too.
		const now = new Date("2026-09-01T12:00:00Z");
		const b = body(
			{
				home: "ARS",
				templates: [
					tpl({
						id: "before",
						frequency: "WEEKLY",
						nextDueDate: new Date("2026-08-30T04:00:00Z"),
					}),
					tpl({
						id: "gap",
						frequency: "WEEKLY",
						nextDueDate: new Date("2026-09-06T04:00:00Z"),
					}),
				],
				rates: { ARS: 1500 },
			},
			{ timeZone: SCL, stepZone: SCL, now },
		);
		expect(b.today).toBe("2026-09-01");
		expect(b.items.map((i) => [i.id, i.next, i.nextAfter, i.paidOnFrom])).toEqual([
			["before", "2026-08-30", "2026-09-06", "2026-08-23"],
			["gap", "2026-09-06", "2026-09-13", "2026-08-30"],
		]);
	});

	it("income steps in UTC days whatever zone the user is in: Oct 31 UTC midnight is Nov 30, never a day off", () => {
		const salary = tpl({
			id: "salary",
			direction: "IN",
			frequency: "MONTHLY",
			nextDueDate: new Date("2026-10-31T00:00:00.000Z"),
			anchorDay: 31,
		});
		const [t] = body(arsHome([salary]), {
			timeZone: "UTC",
			stepZone: BA,
			now: NOW,
		}).items;
		expect(t).toMatchObject({
			next: "2026-10-31",
			nextAfter: "2026-11-30",
			paidOnFrom: "2026-09-30",
		});
		// The confirm step reads the same day from a Buenos Aires step zone or any
		// other, because the schedule steps UTC days.
		expect(
			body(arsHome([salary]), { timeZone: "UTC", stepZone: SCL }).items[0]
				?.nextAfter,
		).toBe("2026-11-30");
	});

	it("the viewer's display zone and the saved step zone are separate", () => {
		// Due Oct 31 Buenos Aires midnight (03:00Z), shown from UTC the same day.
		const [t] = body(
			arsHome([tpl({ id: "rent", anchorDay: 31 })]),
			{ timeZone: "UTC", stepZone: BA },
		).items;
		expect(t?.next).toBe("2026-10-31");
		expect(t?.nextAfter).toBe("2026-11-30");
	});
});

describe("the device loader", () => {
	const row = (iso: string, rate: number, type = "blue"): RateRow => ({
		date: new Date(iso),
		rate,
		type,
	});

	it("orders templates by next due date, then id, as the page does", () => {
		const t = [
			tpl({ id: "b", nextDueDate: ba("2026-11-02") }),
			tpl({ id: "c", nextDueDate: ba("2026-11-01") }),
			tpl({ id: "a", nextDueDate: ba("2026-11-02") }),
		];
		expect(sortRecurringTemplates(t).map((x) => x.id)).toEqual(["c", "a", "b"]);
		expect(t.map((x) => x.id)).toEqual(["b", "c", "a"]);
	});

	it("prices each currency from all its rows: blue beats official, the newest row on or before now wins, a later one is ignored", () => {
		const inputs = recurringInputsFromRows({
			home: "ARS",
			templates: [
				tpl({ id: "a", currency: "USD" }),
				tpl({ id: "b", currency: "XYZ" }),
			],
			rateRows: {
				ARS: [
					row("2026-09-15T00:00:00Z", 1400),
					row("2026-10-05T00:00:00Z", 1500),
					row("2026-10-05T00:00:00Z", 1000, "official"),
					row("2026-11-01T00:00:00Z", 1700),
				],
			},
			now: NOW,
		});
		// USD is 1 and needs no entry; XYZ has no rows at all.
		expect(inputs.rates).toEqual({ ARS: 1500, XYZ: null });
	});

	it("falls back to the nearest later rate when none is on or before now", () => {
		const inputs = recurringInputsFromRows({
			home: "ARS",
			templates: [],
			rateRows: { ARS: [row("2026-12-01T00:00:00Z", 1800)] },
			now: NOW,
		});
		expect(inputs.rates).toEqual({ ARS: 1800 });
	});

	it("names the currencies to price: the home currency and each template's, USD aside, once", () => {
		expect(
			recurringRateCurrencies("ARS", [
				{ currency: "USD" },
				{ currency: "JPY" },
				{ currency: "JPY" },
				{ currency: "ARS" },
			]),
		).toEqual(["ARS", "JPY"]);
		expect(recurringRateCurrencies("USD", [{ currency: "USD" }])).toEqual([]);
	});

	it("computes the same body from the loader's inputs as from hand-built ones", () => {
		const t = [tpl({ id: "a", amount: "10", currency: "USD" })];
		const fromRows = body(
			recurringInputsFromRows({
				home: "ARS",
				templates: t,
				rateRows: { ARS: [row("2026-10-05T00:00:00Z", 1500)] },
				now: NOW,
			}),
		);
		expect(fromRows.items[0]?.home).toEqual({ minor: 1_500_000, currency: "ARS" });
		expect(fromRows).toEqual(body({ home: "ARS", templates: t, rates: { ARS: 1500 } }));
	});
});
