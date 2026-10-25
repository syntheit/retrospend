/**
 * "Can I afford it?" (SYNTHESIS-r6 §4, ported from the kit's
 * `BudgetPlan.afford`): one amount, one answer. Pure: it reads the numbers
 * the month already shows (Left to spend, Left this week, an envelope's Left)
 * and returns the state with every figure in the sentence; the client writes
 * the words. It never writes, so the answer and the Left to spend on the page
 * are the same number (B2).
 *
 * - Flex, Save first and the styles that read as Flex: Left to spend, with a
 *   per-day figure after the purchase, "tight" when that day falls under half
 *   your usual one, and when it does not fit, what covers it.
 * - Every dollar and Limits: one envelope's Left (Limits: no limit says what
 *   it spent instead).
 * - Weekly: this week first, then the month.
 */
import type { AffordState } from "~/lib/schemas/envelope-crud";
import { perDay } from "./pace";
import type { Minor, MonthKey } from "./types";
import type { BudgetStyle } from "./verdict";

/** What the answer offers to do; the service turns the minors into Money. */
export type AffordOffer =
	| { kind: "ADD_TO_SPENDING"; amountMinor: Minor }
	| { kind: "MOVE_MONEY"; envelopeId: string; amountMinor: Minor }
	| { kind: "PLAN_NEXT_MONTH"; month: MonthKey };

export interface AffordNumbers {
	style: BudgetStyle;
	month: MonthKey;
	nextMonth: MonthKey;
	/** The purchase, positive, in the book currency. */
	amount: Minor;
	leftToSpend: { left: Minor; daysLeft: number; notPlanned: Minor };
	/** Weekly books: this week. */
	week: { left: Minor; daysLeftInWeek: number } | null;
	/** Every dollar and Limits: the envelope asked about. */
	envelope: { id: string; left: Minor; hasLimit: boolean; spent: Minor } | null;
	/** What you usually spend a day, from the last closed months. */
	usualPerDay: Minor | null;
}

export interface AffordOutcome {
	scope: "SPENDING" | "ENVELOPE" | "WEEK";
	state: AffordState;
	envelopeId: string | null;
	left: Minor;
	after: Minor;
	short: Minor;
	perDay: Minor;
	daysLeft: number;
	spent: Minor;
	action: AffordOffer | null;
}

/** The day amount after paying: the remainder spread over the days left, all of it on the last day. */
const day = (after: Minor, daysLeft: number) =>
	daysLeft > 0 ? perDay(after, daysLeft) : Math.max(0, after);

function inEnvelope(p: AffordNumbers): AffordOutcome {
	const e = p.envelope as NonNullable<AffordNumbers["envelope"]>;
	const base = {
		scope: "ENVELOPE" as const,
		envelopeId: e.id,
		left: e.left,
		after: e.left - p.amount,
		daysLeft: p.leftToSpend.daysLeft,
		spent: e.spent,
	};
	if (p.style === "LIMITS" && !e.hasLimit)
		return {
			...base,
			state: "NO_LIMIT",
			short: 0,
			perDay: 0,
			action: null,
		};
	if (e.left >= p.amount)
		return {
			...base,
			state: "FITS",
			short: 0,
			perDay: day(base.after, base.daysLeft),
			action: null,
		};
	const short = p.amount - Math.max(0, e.left);
	return {
		...base,
		state: "SHORT_MOVE",
		short,
		perDay: 0,
		action: {
			kind: "MOVE_MONEY",
			envelopeId: e.id,
			amountMinor: short,
		},
	};
}

function thisWeek(p: AffordNumbers): AffordOutcome | null {
	if (p.style !== "WEEKLY" || !p.week) return null;
	const w = p.week;
	const base = {
		scope: "WEEK" as const,
		envelopeId: null,
		left: w.left,
		daysLeft: w.daysLeftInWeek,
		spent: 0,
		action: null,
	};
	if (w.left >= p.amount)
		return {
			...base,
			state: "WEEK_FITS",
			after: w.left - p.amount,
			short: 0,
			perDay: day(w.left - p.amount, w.daysLeftInWeek),
		};
	// Not this week, but the month holds it: it comes out of next week's allowance.
	if (p.leftToSpend.left >= p.amount)
		return {
			...base,
			state: "WEEK_NEXT_WEEK",
			after: p.leftToSpend.left - p.amount,
			short: 0,
			perDay: 0,
		};
	return null;
}

function inSpending(p: AffordNumbers): AffordOutcome {
	const { left, daysLeft, notPlanned } = p.leftToSpend;
	const after = left - p.amount;
	const base = {
		scope: "SPENDING" as const,
		envelopeId: null,
		left,
		after,
		daysLeft,
		spent: 0,
	};
	if (after >= 0) {
		const pd = day(after, daysLeft);
		const tight = p.usualPerDay !== null && 2 * pd < p.usualPerDay;
		return {
			...base,
			state: tight ? "FITS_TIGHT" : "FITS",
			short: 0,
			perDay: pd,
			action: null,
		};
	}
	const short = -after;
	return notPlanned >= short
		? {
				...base,
				state: "SHORT_POOL_COVERS",
				short,
				perDay: 0,
				action: { kind: "ADD_TO_SPENDING", amountMinor: short },
			}
		: {
				...base,
				state: "SHORT_NOTHING_LEFT",
				short,
				perDay: 0,
				action: { kind: "PLAN_NEXT_MONTH", month: p.nextMonth },
			};
}

export function afford(p: AffordNumbers): AffordOutcome {
	if ((p.style === "EVERY_DOLLAR" || p.style === "LIMITS") && p.envelope)
		return inEnvelope(p);
	return thisWeek(p) ?? inSpending(p);
}
