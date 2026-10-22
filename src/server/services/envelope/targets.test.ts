import { describe, expect, it } from "vitest";
import {
	billNeed,
	type MonthlyTarget,
	monthlyNeed,
	movedMoreThan5Percent,
	type SavingsTarget,
	savingsNeed,
	savingsProgress,
} from "./targets";
import { TargetConfigError } from "./types";

/** Whole currency units to minor (2 decimals). */
const m = (n: number) => Math.round(n * 100);

describe("monthlyNeed (SPEC §5.4 Monthly spending)", () => {
	const refill = (
		amount: number,
		cadence: MonthlyTarget["cadence"] = "MONTH",
	): MonthlyTarget => ({
		amount: m(amount),
		mode: "REFILL",
		cadence,
	});
	const setAside = (amount: number): MonthlyTarget => ({
		amount: m(amount),
		mode: "SET_ASIDE",
		cadence: "MONTH",
	});

	it.each([
		{
			name: "refill to 180,000 with 45,000 carried needs 135,000",
			t: refill(180_000),
			weeks: 4,
			carry: 45_000,
			assigned: 0,
			need: 135_000,
		},
		{
			name: "refill with 100,000 already assigned",
			t: refill(180_000),
			weeks: 4,
			carry: 45_000,
			assigned: 100_000,
			need: 35_000,
		},
		{
			name: "refill never goes below 0",
			t: refill(180_000),
			weeks: 4,
			carry: 200_000,
			assigned: 0,
			need: 0,
		},
		{
			name: "set aside 50,000 ignores what carried",
			t: setAside(50_000),
			weeks: 4,
			carry: 45_000,
			assigned: 0,
			need: 50_000,
		},
		{
			name: "set aside minus this month's assigned",
			t: setAside(50_000),
			weeks: 4,
			carry: 0,
			assigned: 20_000,
			need: 30_000,
		},
		{
			name: "A7 weekly 150 x 4 weeks",
			t: refill(150, "WEEK"),
			weeks: 4,
			carry: 0,
			assigned: 0,
			need: 600,
		},
		{
			name: "A7 weekly 150 x 5 weeks",
			t: refill(150, "WEEK"),
			weeks: 5,
			carry: 0,
			assigned: 0,
			need: 750,
		},
		{
			name: "A7 weekly refill counts what carried",
			t: refill(150, "WEEK"),
			weeks: 4,
			carry: 100,
			assigned: 0,
			need: 500,
		},
	])("$name", ({ t, weeks, carry, assigned, need }) => {
		expect(
			monthlyNeed(t, {
				weeksInMonth: weeks,
				carryIn: m(carry),
				assigned: m(assigned),
			}),
		).toBe(m(need));
	});
});

describe("billNeed (SPEC §5.4 Bill)", () => {
	it.each([
		{
			name: "S9 USD 1,200 by May 15 from November: 7 months inclusive",
			amount: 1_200,
			month: 202611,
			due: 202705,
			carry: 0,
			assigned: 0,
			need: 171.43,
		},
		{
			name: "S9 mid-cycle start in February with 400 carried: 200 a month",
			amount: 1_200,
			month: 202702,
			due: 202705,
			carry: 400,
			assigned: 0,
			need: 200,
		},
		{
			name: "S9 in the due month the rest is due",
			amount: 1_200,
			month: 202705,
			due: 202705,
			carry: 1_000,
			assigned: 0,
			need: 200,
		},
		{
			name: "S8 internet ARS 38,000 due this month",
			amount: 38_000,
			month: 202611,
			due: 202611,
			carry: 0,
			assigned: 0,
			need: 38_000,
		},
		{
			name: "S8 template price change to 41,500",
			amount: 41_500,
			month: 202701,
			due: 202701,
			carry: 0,
			assigned: 0,
			need: 41_500,
		},
		{
			name: "assigned this month counts",
			amount: 38_000,
			month: 202611,
			due: 202611,
			carry: 0,
			assigned: 30_000,
			need: 8_000,
		},
		{
			name: "carry covers the bill",
			amount: 38_000,
			month: 202611,
			due: 202611,
			carry: 40_000,
			assigned: 0,
			need: 0,
		},
		{
			name: "a late bill (due month passed) needs the rest now",
			amount: 38_000,
			month: 202612,
			due: 202611,
			carry: 0,
			assigned: 0,
			need: 38_000,
		},
	])("$name", ({ amount, month, due, carry, assigned, need }) => {
		expect(
			billNeed({
				amount: m(amount),
				month,
				dueMonth: due,
				carryIn: m(carry),
				assigned: m(assigned),
			}),
		).toBe(m(need));
	});
});

describe("savingsProgress (B12, D47)", () => {
	it.each([
		{
			name: "B12 money moved to a brokerage still counts",
			s: { left: 0, toWealth: m(1_000_000), fromWealth: 0 },
			out: m(1_000_000),
		},
		{
			name: "money brought back from Wealth no longer counts",
			s: { left: m(50_000), toWealth: m(1_000_000), fromWealth: m(200_000) },
			out: m(850_000),
		},
		{
			name: "a dedicated account counts at its value today",
			s: {
				left: m(50_000),
				toWealth: m(1_000_000),
				fromWealth: 0,
				dedicatedAccountValue: m(3_000_000),
			},
			out: m(3_050_000),
		},
	])("$name", ({ s, out }) => {
		expect(savingsProgress(s)).toBe(out);
	});
});

describe("savingsNeed (SPEC §5.4 savings table)", () => {
	it.each([
		{
			name: "S10 USD 2,000 (ARS 2,930,000) by January from October, 1,450,000 saved",
			t: { amount: m(2_930_000), dueMonth: 202701 },
			month: 202610,
			progress: 1_450_000,
			assigned: 0,
			out: { need: m(370_000) },
		},
		{
			name: "B12 the brokerage transfer is progress, so the need does not ask again",
			t: { amount: m(6_000_000), dueMonth: 202612 },
			month: 202611,
			progress: 6_000_000,
			assigned: 0,
			out: { need: 0 },
		},
		{
			name: "amount and date: assigned this month counts",
			t: { amount: m(1_200), dueMonth: 202705 },
			month: 202611,
			progress: 0,
			assigned: 100,
			out: { need: m(71.43) },
		},
		{
			name: "amount and date: a past-dated goal takes nothing",
			t: { amount: m(1_200), dueMonth: 202605 },
			month: 202606,
			progress: 0,
			assigned: 0,
			out: { need: 0 },
		},
		{
			name: "B13 refill 200 a month until 6,000: four more months after this one",
			t: { amount: m(6_000), monthly: m(200) },
			month: 202611,
			progress: 5_000,
			assigned: 0,
			out: { need: m(200), projectedMonth: 202703 },
		},
		{
			name: "B13 the last 100 is reached this month",
			t: { amount: m(6_000), monthly: m(200) },
			month: 202611,
			progress: 5_900,
			assigned: 0,
			out: { need: m(100), projectedMonth: 202611 },
		},
		{
			name: "monthly and date: total at the date is shown",
			t: { monthly: m(50_000), dueMonth: 202612 },
			month: 202610,
			progress: 0,
			assigned: 0,
			out: { need: m(50_000), totalAtDue: m(150_000) },
		},
		{
			name: "amount only: progress bar, no need",
			t: { amount: m(10_000) },
			month: 202610,
			progress: 0,
			assigned: 0,
			out: { need: 0 },
		},
	])("$name", ({ t, month, progress, assigned, out }) => {
		expect(
			savingsNeed(t, { month, progress: m(progress), assigned: m(assigned) }),
		).toEqual(out);
	});

	it.each<{ name: string; t: SavingsTarget }>([
		{ name: "monthly only", t: { monthly: 1 } },
		{ name: "date only", t: { dueMonth: 202612 } },
		{ name: "all three", t: { amount: 1, monthly: 1, dueMonth: 202612 } },
		{ name: "none", t: {} },
	])("D48 rejects $name", ({ t }) => {
		expect(() =>
			savingsNeed(t, { month: 202610, progress: 0, assigned: 0 }),
		).toThrow(TargetConfigError);
	});

	it.each([
		{ prev: 2_930_000, next: 3_060_000, moved: false },
		{ prev: 2_930_000, next: 3_100_000, moved: true },
		{ prev: 2_930_000, next: 2_760_000, moved: true },
	])(
		"B3 history line when A_H moves more than 5%: $prev -> $next",
		({ prev, next, moved }) => {
			expect(movedMoreThan5Percent(m(prev), m(next))).toBe(moved);
		},
	);
});
