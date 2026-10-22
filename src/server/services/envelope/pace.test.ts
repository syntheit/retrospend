import { describe, expect, it } from "vitest";
import {
	billsStillNeeded,
	daysLeftIncluding,
	defaultWeekStartDay,
	leftThisWeek,
	leftToSpend,
	perDay,
	spendingFasterThanPlanned,
	weeklyPace,
	weeksOfMonth,
} from "./pace";
import type { EnvelopeKind } from "./types";

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

describe("leftToSpend (owner r6 Q1: Spending only, minus a negative To assign)", () => {
	const envs: Array<{ kind: EnvelopeKind; left: number }> = [
		{ kind: "MONTHLY", left: m(40_000) },
		{ kind: "MONTHLY", left: m(-12_000) },
		{ kind: "NONE", left: m(31_161) },
		{ kind: "BILL", left: m(68_480) },
		{ kind: "SAVINGS", left: m(1_450_000) },
	];

	it.each([
		{
			name: "r6 Flex seed: bills and savings are not in it, Not planned yet is a notice",
			toAssign: 850_000,
			left: 59_161,
			notPlanned: 850_000,
			tooMuch: 0,
		},
		{
			name: "D23 a negative To assign comes off the number",
			toAssign: -576_200,
			left: 59_161 - 576_200,
			notPlanned: 0,
			tooMuch: 576_200,
		},
		{
			name: "To assign at 0",
			toAssign: 0,
			left: 59_161,
			notPlanned: 0,
			tooMuch: 0,
		},
	])("$name", ({ toAssign, left, notPlanned, tooMuch }) => {
		expect(leftToSpend(envs, m(toAssign))).toEqual({
			left: m(left),
			spendingLeft: m(59_161),
			plannedTooMuch: m(tooMuch),
			notPlannedYet: m(notPlanned),
		});
	});

	it("bills still needed is the sum of this month's bill needs", () => {
		expect(billsStillNeeded([m(40_000), 0])).toBe(m(40_000));
		expect(billsStillNeeded([])).toBe(0);
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
