import type { Money } from "@retrospend/domain/money-minor";
import type { BudgetEnvelope, BudgetGroup, BudgetStyle } from "./source";

// Which rows the Budget list shows and the words under them. The server
// decides each envelope's status and every figure; this only picks.

/** Flex and Save first fold each group into one row; Weekly opens only Spending. */
export function groupStartsOpen(
	style: BudgetStyle,
	group: Pick<BudgetGroup, "role">,
): boolean {
	switch (style) {
		case "FLEX":
		case "SAVE_FIRST":
			return false;
		case "WEEKLY":
			return group.role === "SPENDING";
		default:
			return true;
	}
}

/** A group's own key: its id, or "none" for envelopes without one. */
export function groupKey(group: Pick<BudgetGroup, "id">): string {
	return group.id ?? "none";
}

/** Limits books call the assigned column Limit, and hide the pool (SPEC 6.1). */
export function isLimits(style: BudgetStyle): boolean {
	return style === "LIMITS";
}

/** The Left a group header shows: in Limits only the envelopes that have a limit count. */
export function groupLeft(style: BudgetStyle, group: BudgetGroup): Money {
	return isLimits(style) && group.totals.limitLeft
		? group.totals.limitLeft
		: group.totals.left;
}

export type StatusLine =
	| { kind: "over"; amount: Money }
	| { kind: "needs"; amount: Money }
	| { kind: "funded" }
	| { kind: "noRate"; currency: string };

/**
 * The line under an envelope's name. Words carry the status as well as the
 * color: an over envelope says "Over by", never only turns red.
 */
export function statusLine(e: BudgetEnvelope): StatusLine | null {
	if (e.target?.incomplete) {
		return { kind: "noRate", currency: e.target.foreign?.currency ?? "" };
	}
	switch (e.status) {
		case "OVERSPENT":
			return { kind: "over", amount: e.left };
		case "UNDERFUNDED":
			return e.target ? { kind: "needs", amount: e.target.need } : null;
		case "FUNDED":
			return e.target ? { kind: "funded" } : null;
		default:
			return null;
	}
}

/** The envelopes that are over, in list order (what Cover works on). */
export function overEnvelopes(data: {
	groups: readonly BudgetGroup[];
}): BudgetEnvelope[] {
	return data.groups.flatMap((g) =>
		g.envelopes.filter((e) => e.status === "OVERSPENT"),
	);
}

/** What a tap on an envelope can start, for this style and month. */
export interface EnvelopeActions {
	assign: boolean;
	move: boolean;
	cover: boolean;
	limit: boolean;
}

/**
 * A closed month is read-only. A Limits book edits limits, not assigned
 * money, and has no pool to cover from. The month after the open one can be
 * planned but nothing is spent in it, so it has nothing to cover.
 */
export function envelopeActions(
	e: BudgetEnvelope,
	style: BudgetStyle,
	month: "closed" | "open" | "next",
): EnvelopeActions {
	const none = { assign: false, move: false, cover: false, limit: false };
	if (month === "closed") return none;
	if (isLimits(style)) return { ...none, limit: true };
	return {
		assign: true,
		move: true,
		cover: month === "open" && e.status === "OVERSPENT",
		limit: false,
	};
}
