import type { Verdict } from "./source";
import {
	joinNames,
	verdictActionKey,
	verdictIsOver,
	verdictLabel,
	verdictSentence,
	verdictSheet,
} from "./verdict";

const ars = (minor: number) => ({ minor, currency: "ARS" });

function verdict(over: Partial<Verdict> = {}): Verdict {
	return {
		style: "FLEX",
		month: 202610,
		lead: {
			kind: "LEFT_TO_SPEND",
			figureId: "budget.leftToSpend",
			amount: ars(500000),
		},
		state: "ON_TRACK",
		perDay: ars(20000),
		daysLeft: 6,
		over: ars(0),
		overEnvelopes: [],
		billsShort: ars(0),
		plannedTooMuch: ars(0),
		resetsOn: null,
		action: null,
		notice: null,
		poolName: "NOT_PLANNED_YET",
		limits: null,
		incomplete: false,
		...over,
	};
}

describe("verdict label", () => {
	it("names the lead and the month", () => {
		expect(verdictLabel(verdict(), false)).toEqual({
			key: "label.leftToSpend",
			values: { month: { kind: "month", key: 202610 } },
		});
		expect(verdictLabel(verdict(), true).key).toBe("label.saveFirst");
		expect(verdictLabel(verdict({ state: "OVER_BUDGET" }), false).key).toBe(
			"label.overBudget",
		);
	});

	it("follows the lead kind", () => {
		const lead = (kind: Verdict["lead"]["kind"]) => ({
			lead: { kind, figureId: "x", amount: ars(1) },
		});
		expect(verdictLabel(verdict(lead("TO_ASSIGN")), false).key).toBe(
			"label.toAssign",
		);
		expect(verdictLabel(verdict(lead("LEFT_THIS_WEEK")), false).key).toBe(
			"label.week",
		);
		expect(verdictLabel(verdict(lead("LEFT_IN_LIMITS")), false).key).toBe(
			"label.limits",
		);
		expect(
			verdictLabel(
				verdict({ ...lead("LEFT_IN_LIMITS"), state: "OVER_BUDGET" }),
				false,
			).key,
		).toBe("label.overLimits");
	});
});

describe("verdict sentence", () => {
	it("on track carries the per-day amount and the days left", () => {
		expect(verdictSentence(verdict())).toEqual({
			key: "onTrack",
			values: {
				amount: { kind: "money", money: ars(20000), whole: true },
				days: { kind: "number", value: 6 },
			},
		});
	});

	it("over budget reads the amount without a sign and names this and next month", () => {
		const line = verdictSentence(
			verdict({
				state: "OVER_BUDGET",
				lead: { kind: "LEFT_TO_SPEND", figureId: "x", amount: ars(-30000) },
			}),
		);
		expect(line.key).toBe("overBudget");
		expect(line.values.amount).toEqual({
			kind: "money",
			money: ars(-30000),
			unsigned: true,
		});
		expect(line.values.next).toEqual({ kind: "month", key: 202611 });
		expect(verdictIsOver(verdict({ state: "OVER_BUDGET" }))).toBe(true);
		expect(verdictIsOver(verdict())).toBe(false);
	});

	it("Limits has its own sentences", () => {
		const limits = {
			lead: { kind: "LEFT_IN_LIMITS" as const, figureId: "x", amount: ars(1) },
		};
		expect(verdictSentence(verdict({ ...limits, state: "USED_UP" })).key).toBe(
			"limitsUsedUp",
		);
		expect(
			verdictSentence(verdict({ ...limits, state: "SOME_OVER" })).key,
		).toBe("limitsSomeOver");
	});

	it("lists the envelopes that went over by id, in the server's order", () => {
		const line = verdictSentence(
			verdict({
				state: "SOME_OVER",
				over: ars(1500),
				overEnvelopes: [
					{ id: "a", over: ars(1000) },
					{ id: "b", over: ars(500) },
				],
			}),
		);
		expect(line.values.names).toEqual({ kind: "names", ids: ["a", "b"] });
	});

	it("a week verdict says when it resets", () => {
		const line = verdictSentence(
			verdict({ state: "WEEK_LEFT", resetsOn: "2026-10-26" }),
		);
		expect(line).toMatchObject({
			key: "weekLeft",
			values: { resets: { kind: "date", iso: "2026-10-26" } },
		});
	});
});

describe("joining names", () => {
	it("uses the catalog's and between the last two", () => {
		const and = (head: string, last: string) => `${head} and ${last}`;
		expect(joinNames([], and)).toBe("");
		expect(joinNames(["Cafe"], and)).toBe("Cafe");
		expect(joinNames(["Cafe", "Transport"], and)).toBe("Cafe and Transport");
		expect(joinNames(["A", "B", "C"], and)).toBe("A, B and C");
	});
});

describe("verdict action", () => {
	it("maps each action to a phone sheet", () => {
		expect(verdictSheet(verdict({ action: "USE_PLAN" }))).toBe("usePlan");
		expect(verdictSheet(verdict({ action: "PLAN_BILLS" }))).toBe("usePlan");
		expect(verdictSheet(verdict({ action: "FIX_PLAN" }))).toBe("takeBack");
		expect(verdictSheet(verdict({ action: "TAKE_BACK" }))).toBe("takeBack");
		expect(verdictSheet(verdict({ action: "COVER" }))).toBe("cover");
		expect(verdictSheet(verdict({ action: null }))).toBeNull();
	});

	it("Limits raises the limit instead of covering", () => {
		const limits = verdict({
			action: "COVER",
			lead: { kind: "LEFT_IN_LIMITS", figureId: "x", amount: ars(1) },
		});
		expect(verdictSheet(limits)).toBe("raiseLimit");
		expect(verdictActionKey("COVER", true)).toBe("action.raiseLimit");
		expect(verdictActionKey("COVER", false)).toBe("action.COVER");
	});
});
