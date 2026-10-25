import { describe, expect, it } from "vitest";
import {
	daysLeftIncluding,
	defaultWeekStartDay,
	type GroupRole,
	type LeftToSpendEnvelope,
	leftThisWeek,
	leftToSpend,
	perDay,
	spendingFasterThanPlanned,
	weeklyPace,
	weeksOfMonth,
} from "./pace";

const m = (n: number) => Math.round(n * 100);
const MON = 1;
const SUN = 0;

describe("weeksOfMonth (SPEC §5.4)", () => {
	it.each([
		{
			name: "October 2026, weeks start Monday: leading days join week 1",
			from: "2026-10-01",
			to: "2026-10-31",
			start: MON,
			weeks: [
				["2026-10-01", "2026-10-11"],
				["2026-10-12", "2026-10-18"],
				["2026-10-19", "2026-10-25"],
				["2026-10-26", "2026-10-31"],
			],
		},
		{
			name: "October 2026, weeks start Sunday",
			from: "2026-10-01",
			to: "2026-10-31",
			start: SUN,
			weeks: [
				["2026-10-01", "2026-10-10"],
				["2026-10-11", "2026-10-17"],
				["2026-10-18", "2026-10-24"],
				["2026-10-25", "2026-10-31"],
			],
		},
		{
			name: "November 2026, weeks start Sunday: 5 weeks",
			from: "2026-11-01",
			to: "2026-11-30",
			start: SUN,
			weeks: [
				["2026-11-01", "2026-11-07"],
				["2026-11-08", "2026-11-14"],
				["2026-11-15", "2026-11-21"],
				["2026-11-22", "2026-11-28"],
				["2026-11-29", "2026-11-30"],
			],
		},
		{
			name: "November 2026, weeks start Monday: 5 weeks, the last one a day",
			from: "2026-11-01",
			to: "2026-11-30",
			start: MON,
			weeks: [
				["2026-11-01", "2026-11-08"],
				["2026-11-09", "2026-11-15"],
				["2026-11-16", "2026-11-22"],
				["2026-11-23", "2026-11-29"],
				["2026-11-30", "2026-11-30"],
			],
		},
		{
			name: "C20 a fiscal month Oct 25 to Nov 24",
			from: "2026-10-25",
			to: "2026-11-24",
			start: MON,
			weeks: [
				["2026-10-25", "2026-11-01"],
				["2026-11-02", "2026-11-08"],
				["2026-11-09", "2026-11-15"],
				["2026-11-16", "2026-11-22"],
				["2026-11-23", "2026-11-24"],
			],
		},
		{
			name: "February 2027 starting on a Monday: exactly 4 weeks",
			from: "2027-02-01",
			to: "2027-02-28",
			start: MON,
			weeks: [
				["2027-02-01", "2027-02-07"],
				["2027-02-08", "2027-02-14"],
				["2027-02-15", "2027-02-21"],
				["2027-02-22", "2027-02-28"],
			],
		},
		{
			name: "C20 a short transition month with no week start is one week",
			from: "2026-11-25",
			to: "2026-11-28",
			start: MON,
			weeks: [["2026-11-25", "2026-11-28"]],
		},
	])("$name", ({ from, to, start, weeks }) => {
		const out = weeksOfMonth({ from, to, weekStartDay: start });
		expect(out.map((w) => [w.from, w.to])).toEqual(weeks);
		expect(out.map((w) => w.index)).toEqual(weeks.map((_, i) => i + 1));
	});

	it("week start follows the locale", () => {
		expect(defaultWeekStartDay("en-US")).toBe(SUN);
		expect(defaultWeekStartDay("es-AR")).toBe(MON);
	});
});

describe("leftThisWeek (A7: 150 a week, resets Monday)", () => {
	it.each([
		{
			name: "week 1, spent 50",
			left: 550,
			carry: 0,
			i: 1,
			spent: 50,
			out: 100,
		},
		{
			name: "week 2, unspent week 1 rolls in",
			left: 500,
			carry: 0,
			i: 2,
			spent: 100,
			out: 200,
		},
		{
			name: "week 2, overspending in week 1 shrinks it",
			left: 200,
			carry: 0,
			i: 2,
			spent: 400,
			out: -100,
		},
		{
			name: "carry from last month adds to the allowance",
			left: 700,
			carry: 100,
			i: 1,
			spent: 0,
			out: 250,
		},
		{
			name: "never more than the envelope holds",
			left: 50,
			carry: 0,
			i: 3,
			spent: 150,
			out: 50,
		},
	])("$name", ({ left, carry, i, spent, out }) => {
		expect(
			leftThisWeek({
				left: m(left),
				carryIn: m(carry),
				weekly: m(150),
				weekIndex: i,
				spentMonthToDate: m(spent),
			}),
		).toBe(m(out));
	});

	it("weeklyPace: per day until the week ends and the reset day", () => {
		const out = weeklyPace({
			today: "2026-10-14",
			month: { from: "2026-10-01", to: "2026-10-31", weekStartDay: MON },
			left: m(450),
			carryIn: 0,
			weekly: m(150),
			spentMonthToDate: m(180),
		});
		expect(out).toMatchObject({
			weeks: 4,
			leftThisWeek: m(120),
			daysLeftInWeek: 5,
			perDay: m(24),
			resetsOn: "2026-10-19",
		});
		expect(out.week.index).toBe(2);
	});

	it("weeklyPace in the last week has no reset inside the month", () => {
		const out = weeklyPace({
			today: "2026-10-30",
			month: { from: "2026-10-01", to: "2026-10-31", weekStartDay: MON },
			left: m(100),
			carryIn: 0,
			weekly: m(150),
			spentMonthToDate: m(500),
		});
		expect(out).toMatchObject({
			leftThisWeek: m(100),
			resetsOn: null,
			daysLeftInWeek: 2,
			perDay: m(50),
		});
	});
});

describe("leftToSpend (D-owner-2026-10-22d, kit BudgetPlan.leftToSpend)", () => {
	const env = (
		groupRole: GroupRole,
		carry: number,
		assigned: number,
		activity: number,
	): LeftToSpendEnvelope => ({
		groupRole,
		carryIn: m(carry),
		assigned: m(assigned),
		activity: m(activity),
		left: m(carry + assigned + activity),
	});
	/** r6 seed on Oct 21: Spending left 59,161, bills held 68,480. */
	const seed = [
		env("SPENDING", 0, 400_000, -360_000),
		env("SPENDING", 10_000, 180_000, -202_000),
		env("SPENDING", 0, 50_000, -18_839),
		env("BILLS", 0, 718_480, -650_000),
		env("SAVINGS", 0, 1_450_000, 0),
	];
	const OCT = { from: "2026-10-01", to: "2026-10-31" };
	const run = (o: {
		toAssign: number;
		envelopes?: LeftToSpendEnvelope[];
		today?: string;
		billNeeds?: number[];
		recurringSpent?: number;
	}) =>
		leftToSpend({
			envelopes: o.envelopes ?? seed,
			toAssign: m(o.toAssign),
			billNeeds: (o.billNeeds ?? []).map(m),
			month: OCT,
			today: o.today ?? "2026-10-21",
			recurringSpent: m(o.recurringSpent ?? 0),
		});

	it("a tracked-only Limits envelope (no limit) shows its spending but is never over and not in Left", () => {
		// Groceries 400.00 limit, 100.00 over; pegged Dining spent 80.00; Everything else spent 40.00.
		const groceries = env("SPENDING", 0, 400, -500);
		const dining = { ...env("SPENDING", 0, 0, -80), tracksOnly: true };
		const rest = { ...env("SPENDING", 0, 0, -40), tracksOnly: true };
		const r = run({ toAssign: 0, envelopes: [groceries, dining, rest] });
		expect(r.over).toBe(m(100));
		expect(r.spendingLeft).toBe(m(-100));
		// Spending still counts them: 500 + 80 + 40.
		expect(r.spent).toBe(m(620));
		const onlyTracked = run({ toAssign: 0, envelopes: [dining, rest] });
		expect(onlyTracked.over).toBe(0);
		expect(onlyTracked.spendingLeft).toBe(0);
	});

	it("D-owner-2026-10-22d the Spending group only: bills, savings and Not planned yet stay out", () => {
		expect(run({ toAssign: 850_000, billNeeds: [40_000, 0] })).toEqual({
			left: m(59_161),
			perDay: m(5_378.27),
			daysLeft: 11,
			carry: m(10_000),
			assigned: m(630_000),
			pool: m(640_000),
			spent: m(580_839),
			spendingLeft: m(59_161),
			plannedTooMuch: 0,
			over: m(12_000),
			billsHeld: m(68_480),
			billsShort: m(40_000),
			billsCount: 1,
			savings: m(1_450_000),
			notPlanned: m(850_000),
			fasterThanPlanned: true,
		});
	});

	it.each([
		{
			name: "D-owner-2026-10-22d a negative To assign comes off the number",
			toAssign: -576_200,
			out: {
				left: m(59_161 - 576_200),
				plannedTooMuch: m(576_200),
				notPlanned: 0,
				perDay: 0,
				fasterThanPlanned: false,
			},
		},
		{
			name: "D-owner-2026-10-22d To assign at 0 changes nothing",
			toAssign: 0,
			out: { left: m(59_161), plannedTooMuch: 0, notPlanned: 0 },
		},
	])("$name", ({ toAssign, out }) => {
		expect(run({ toAssign })).toMatchObject(out);
	});

	it("D-owner-2026-10-22d by group, not by kind: what sits in Savings or Bills never counts", () => {
		const out = run({
			toAssign: 0,
			envelopes: [
				env("SPENDING", 0, 100_000, -20_000),
				env("SAVINGS", 0, 50_000, 0),
				env(null, 0, 30_000, 0),
			],
		});
		expect(out.left).toBe(m(80_000));
	});

	it("D-owner-2026-10-22d on track: spending behind the share of the month gone", () => {
		const out = run({
			toAssign: 0,
			envelopes: [env("SPENDING", 0, 640_000, -300_000)],
		});
		expect(out.fasterThanPlanned).toBe(false);
	});

	it("D60 the pace line leaves recurring spending out of both sides", () => {
		// Seed: pool 640,000, spent 580,839 on day 21 of 31 is faster than
		// planned (90.8% spent, 67.7% of the month gone). With 400,000 of that
		// posted by recurring templates, the rest is 180,839 of 240,000:
		// 75.3% spent, still more than 5 points ahead: faster.
		expect(
			run({ toAssign: 0, recurringSpent: 400_000 }).fasterThanPlanned,
		).toBe(true);
		// With 500,000 recurring, the rest is 80,839 of 140,000: 57.7% spent,
		// behind the 67.7% of the month gone: on track. The hero is unchanged.
		const out = run({ toAssign: 0, recurringSpent: 500_000 });
		expect(out).toMatchObject({
			fasterThanPlanned: false,
			left: m(59_161),
			spent: m(580_839),
		});
	});

	it("D-owner-2026-10-22d a closed month reads as the whole month gone", () => {
		const out = run({ toAssign: 0, today: "2026-11-03" });
		expect(out).toMatchObject({ daysLeft: 0, perDay: 0, left: m(59_161) });
	});
});

describe("per-day figures", () => {
	it.each([
		{
			name: "r6: 59,161 over 11 days is about 5,378.27 a day",
			amount: 59_161,
			days: 11,
			out: 5_378.27,
		},
		{ name: "nothing left is 0 a day", amount: -100, days: 11, out: 0 },
		{ name: "no days left is 0 a day", amount: 100, days: 0, out: 0 },
	])("$name", ({ amount, days, out }) => {
		expect(perDay(m(amount), days)).toBe(m(out));
	});

	it("days left include today", () => {
		expect(daysLeftIncluding("2026-10-21", "2026-10-31")).toBe(11);
		expect(daysLeftIncluding("2026-11-01", "2026-10-31")).toBe(0);
	});

	it.each([
		{
			name: "75% spent on day 15 of 30 is faster than planned",
			pool: 600_000,
			spent: 450_000,
			day: 15,
			out: true,
		},
		{
			name: "50% spent on day 15 of 30 is on track",
			pool: 600_000,
			spent: 300_000,
			day: 15,
			out: false,
		},
		{
			name: "exactly 5 points ahead is still on track",
			pool: 600_000,
			spent: 330_000,
			day: 15,
			out: false,
		},
		{ name: "no plan, no pace", pool: 0, spent: 10_000, day: 15, out: false },
	])("$name", ({ pool, spent, day, out }) => {
		expect(
			spendingFasterThanPlanned({
				pool: m(pool),
				spent: m(spent),
				dayOfMonth: day,
				daysInMonth: 30,
			}),
		).toBe(out);
	});
});
