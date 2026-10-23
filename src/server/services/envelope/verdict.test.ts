import { describe, expect, it } from "vitest";
import type { LeftToSpend } from "./pace";
import { poolNameFor, verdict } from "./verdict";

const base: LeftToSpend = {
	left: 59_161,
	perDay: 5_378,
	daysLeft: 11,
	carry: 10_000,
	assigned: 630_000,
	pool: 640_000,
	spent: 580_839,
	spendingLeft: 59_161,
	plannedTooMuch: 0,
	over: 0,
	billsHeld: 0,
	billsShort: 0,
	billsCount: 0,
	savings: 0,
	notPlanned: 0,
	fasterThanPlanned: false,
};

const run = (
	l: Partial<LeftToSpend>,
	o: {
		style?: "FLEX" | "EVERY_DOLLAR" | "WEEKLY";
		toAssign?: number;
		over?: number;
		week?: number;
	} = {},
) =>
	verdict({
		style: o.style ?? "FLEX",
		month: 202610,
		toAssign: o.toAssign ?? 0,
		leftToSpend: { ...base, ...l },
		overspent: o.over ? [{ id: "dining", over: o.over }] : [],
		week:
			o.week === undefined
				? null
				: {
						left: o.week,
						perDay: 0,
						daysLeftInWeek: 3,
						resetsOn: "2026-10-26",
					},
	});

describe("verdict states, first that applies (SYNTHESIS-r6 §4)", () => {
	it.each([
		[
			"planned more than you have",
			{ plannedTooMuch: 1, left: -5 },
			{},
			"PLANNED_TOO_MUCH",
			"FIX_PLAN",
		],
		["Spending over in total", { left: -23_500 }, {}, "OVER_BUDGET", "COVER"],
		[
			"bills still short",
			{ billsShort: 40_000 },
			{},
			"BILLS_SHORT",
			"PLAN_BILLS",
		],
		["exactly used up", { left: 0 }, {}, "USED_UP", null],
		[
			"spending faster than planned",
			{ fasterThanPlanned: true },
			{ over: 100 },
			"FASTER_THAN_PLANNED",
			null,
		],
		[
			"some envelopes over, total fine",
			{},
			{ over: 80_400 },
			"SOME_OVER",
			null,
		],
		["on track", {}, {}, "ON_TRACK", null],
	] as const)("Flex: %s", (_name, l, o, state, action) => {
		expect(run(l, o)).toMatchObject({
			state,
			action,
			lead: { kind: "LEFT_TO_SPEND", figureId: "budget.leftToSpend" },
		});
	});

	it("Flex: Not planned yet is a notice, never in the number", () => {
		const v = run({ notPlanned: 850_000 });
		expect(v.lead.amount).toBe(59_161);
		expect(v.notice).toEqual({
			kind: "NOT_PLANNED_YET",
			amount: 850_000,
			action: "USE_PLAN",
		});
		expect(v.poolName).toBe("NOT_PLANNED_YET");
	});

	it.each([
		[0, "ALL_ASSIGNED", null],
		[850_000, "NEEDS_JOB", "USE_PLAN"],
		[-576_200, "OVER_ASSIGNED", "TAKE_BACK"],
	] as const)(
		"Every dollar: To assign %d reads %s",
		(toAssign, state, action) => {
			expect(run({}, { style: "EVERY_DOLLAR", toAssign })).toMatchObject({
				state,
				action,
				lead: { kind: "TO_ASSIGN", amount: toAssign },
			});
		},
	);

	it("Every dollar: overspending is the notice, with Cover", () => {
		expect(run({}, { style: "EVERY_DOLLAR", over: 48_400 }).notice).toEqual({
			kind: "OVERSPENT",
			amount: 48_400,
			action: "COVER",
		});
		expect(poolNameFor("EVERY_DOLLAR")).toBe("TO_ASSIGN");
	});

	it("Weekly: this week's money leads; used up reads WEEK_USED; no weekly envelopes reads as Flex", () => {
		expect(run({}, { style: "WEEKLY", week: 32_000 })).toMatchObject({
			state: "WEEK_LEFT",
			resetsOn: "2026-10-26",
			lead: { kind: "LEFT_THIS_WEEK", amount: 32_000 },
		});
		expect(run({}, { style: "WEEKLY", week: 0 }).state).toBe("WEEK_USED");
		expect(run({}, { style: "WEEKLY" }).lead.kind).toBe("LEFT_TO_SPEND");
	});
});
