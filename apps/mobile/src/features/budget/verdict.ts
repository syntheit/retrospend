import type { Money } from "@retrospend/domain/money-minor";
import { addMonths } from "./months";
import type { Verdict } from "./source";

// The words of the verdict (the number and the one sentence at the top of
// Budget). The server picks the state and carries every figure; this only
// chooses which message and which of the verdict's own values go into it.

export type VerdictValue =
	| { kind: "money"; money: Money; unsigned?: boolean }
	| { kind: "month"; key: number }
	| { kind: "date"; iso: string }
	| { kind: "names"; ids: string[] }
	| { kind: "number"; value: number };

export interface VerdictLine {
	/** A key under `mobile.budget.verdict`. */
	key: string;
	values: Record<string, VerdictValue>;
}

export type VerdictAction = NonNullable<Verdict["action"]>;

const money = (m: Money): VerdictValue => ({ kind: "money", money: m });
/** The sentence calls it "over" or "more", so the wording carries the sign, not the number. */
const unsigned = (m: Money): VerdictValue => ({
	kind: "money",
	money: m,
	unsigned: true,
});

/** The label over the number. */
export function verdictLabel(v: Verdict, saveFirst: boolean): VerdictLine {
	const month: VerdictValue = { kind: "month", key: v.month };
	switch (v.lead.kind) {
		case "TO_ASSIGN":
			return { key: "label.toAssign", values: {} };
		case "LEFT_THIS_WEEK":
			return { key: "label.week", values: {} };
		case "LEFT_IN_LIMITS":
			return {
				key: v.state === "OVER_BUDGET" ? "label.overLimits" : "label.limits",
				values: {},
			};
		default:
			if (v.state === "OVER_BUDGET")
				return { key: "label.overBudget", values: { month } };
			return {
				key: saveFirst ? "label.saveFirst" : "label.leftToSpend",
				values: { month },
			};
	}
}

/** An over verdict reads how far over, with no minus sign. */
export function verdictIsOver(v: Verdict): boolean {
	return v.state === "OVER_BUDGET" || v.state === "OVER_ASSIGNED";
}

/** The one sentence under the number. */
export function verdictSentence(v: Verdict): VerdictLine {
	const month: VerdictValue = { kind: "month", key: v.month };
	const next: VerdictValue = { kind: "month", key: addMonths(v.month, 1) };
	const amount = money(v.perDay);
	const days: VerdictValue = { kind: "number", value: v.daysLeft };
	const limits = v.lead.kind === "LEFT_IN_LIMITS";
	const resets: VerdictValue = { kind: "date", iso: v.resetsOn ?? "" };
	switch (v.state) {
		case "PLANNED_TOO_MUCH":
			return {
				key: "plannedTooMuch",
				values: { amount: unsigned(v.plannedTooMuch) },
			};
		case "OVER_BUDGET":
			return {
				key: limits ? "limitsOver" : "overBudget",
				values: { amount: unsigned(v.lead.amount), month, next },
			};
		case "BILLS_SHORT":
			return {
				key: "billsShort",
				values: { amount: unsigned(v.billsShort) },
			};
		case "USED_UP":
			return { key: limits ? "limitsUsedUp" : "usedUp", values: { month, next } };
		case "FASTER_THAN_PLANNED":
			return { key: limits ? "limitsFaster" : "faster", values: { amount } };
		case "SOME_OVER":
			return {
				key: limits ? "limitsSomeOver" : "someOver",
				values: {
					amount,
					over: unsigned(v.over),
					days,
					names: { kind: "names", ids: v.overEnvelopes.map((e) => e.id) },
				},
			};
		case "ON_TRACK":
			return {
				key: limits ? "limitsOnTrack" : "onTrack",
				values: { amount, days },
			};
		case "ALL_ASSIGNED":
			return { key: "allAssigned", values: {} };
		case "NEEDS_JOB":
			return { key: "needsJob", values: { amount: money(v.lead.amount) } };
		case "OVER_ASSIGNED":
			return {
				key: "overAssigned",
				values: { amount: unsigned(v.lead.amount) },
			};
		case "WEEK_LEFT":
			return { key: "weekLeft", values: { amount, resets } };
		case "WEEK_USED":
			return { key: "weekUsed", values: { resets } };
	}
}

/** The button label key for a verdict action (Limits raises the limit instead of covering). */
export function verdictActionKey(
	action: VerdictAction,
	limits: boolean,
): string {
	return limits && action === "COVER" ? "action.raiseLimit" : `action.${action}`;
}

/** The sheet a verdict button opens on this phone. */
export type VerdictSheet = "cover" | "raiseLimit" | "usePlan" | "takeBack";

export function verdictSheet(v: Verdict): VerdictSheet | null {
	const limits = v.lead.kind === "LEFT_IN_LIMITS";
	switch (v.action) {
		case "COVER":
			return limits ? "raiseLimit" : "cover";
		case "USE_PLAN":
		case "PLAN_BILLS":
			return "usePlan";
		case "FIX_PLAN":
		case "TAKE_BACK":
			return "takeBack";
		default:
			return null;
	}
}
