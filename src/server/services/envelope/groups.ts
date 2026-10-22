/**
 * Groups and % targets (SPEC §5.9, owner Q6, 50/30/20; 02 §3.5).
 *
 * - Base for %: this month's budget income (income rows entering To assign,
 *   book value). Before any income arrives: typical income, the median of
 *   the last 3 closed months ("of your usual income").
 * - T_g = a fixed amount, or % x base. Group need = max(0, T_g - Σ assigned
 *   in the group this month). Children with their own targets fill first;
 *   the rest goes to the main envelope (`mainEnvelopeId`, default the first
 *   envelope without a target).
 * - Header shares: planned % = T_g / base, spent % = spending activity / base.
 *
 * Percentages are basis points (3000 = 30%). All money is H minor units.
 */
import type { GroupTargetKind, Minor } from "./types";
import { mulDiv, percentOf, ratioBp, sumMinor } from "./units";

/**
 * Typical income: median of the last 3 closed months' budget income, given
 * oldest first. With 2 months it is their mean (half-even); with none, null.
 */
export function typicalIncome(closedMonths: readonly Minor[]): Minor | null {
	const last = closedMonths.slice(-3);
	if (last.length === 0) return null;
	const sorted = [...last].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return sorted[mid] as Minor;
	return mulDiv((sorted[mid - 1] as Minor) + (sorted[mid] as Minor), 1, 2);
}

export type BaseSource = "THIS_MONTH" | "TYPICAL";

/** The base for % targets this month, or null before any income exists. */
export function percentBase(p: {
	thisMonthIncome: Minor;
	closedMonthIncomes: readonly Minor[];
}): { base: Minor; source: BaseSource } | null {
	if (p.thisMonthIncome > 0)
		return { base: p.thisMonthIncome, source: "THIS_MONTH" };
	const typical = typicalIncome(p.closedMonthIncomes);
	return typical && typical > 0 ? { base: typical, source: "TYPICAL" } : null;
}

export interface GroupTarget {
	kind: GroupTargetKind;
	/** AMOUNT: H minor units; PERCENT_OF_INCOME: basis points. */
	value: number;
}

/** T_g, or null when the group has no target or a % target has no base yet. */
export function groupTargetAmount(
	t: GroupTarget,
	base: Minor | null,
): Minor | null {
	if (t.kind === "AMOUNT") return t.value;
	if (t.kind === "PERCENT_OF_INCOME")
		return base == null ? null : percentOf(base, t.value);
	return null;
}

export interface GroupMember {
	envelopeId: string;
	order: number;
	/** Has its own target (any kind other than No target). */
	hasTarget: boolean;
	assigned: Minor;
	/** This month's need from targets.ts (0 without a target). */
	need: Minor;
}

/** The group's main envelope: the one set, else the first without a target. */
export function mainEnvelopeOf(
	mainEnvelopeId: string | null | undefined,
	members: readonly GroupMember[],
): string | null {
	if (mainEnvelopeId && members.some((m) => m.envelopeId === mainEnvelopeId))
		return mainEnvelopeId;
	const first = [...members]
		.sort((a, b) => a.order - b.order)
		.find((m) => !m.hasTarget);
	return first?.envelopeId ?? null;
}

export interface GroupPlan {
	target: Minor;
	assigned: Minor;
	/** max(0, T_g - Σ assigned). */
	groupNeed: Minor;
	/** Σ needs of children with their own targets (filled first). */
	childNeeds: Minor;
	mainEnvelopeId: string | null;
	/** What goes to the main envelope after the children's needs. */
	mainExtra: Minor;
	/** Guidance only: how much the children's targets ask beyond T_g ("need X more than Wants' 30%"). */
	childrenOverBy: Minor;
}

/** How a targeted group's need splits between its children and its main envelope. */
export function groupPlan(
	target: Minor,
	members: readonly GroupMember[],
	mainEnvelopeId?: string | null,
): GroupPlan {
	const assigned = sumMinor(members.map((m) => m.assigned));
	const groupNeed = Math.max(0, target - assigned);
	const main = mainEnvelopeOf(mainEnvelopeId, members);
	const children = members.filter((m) => m.hasTarget);
	const childNeeds = sumMinor(children.map((m) => m.need));
	const childAsk = sumMinor(children.map((m) => m.assigned + m.need));
	return {
		target,
		assigned,
		groupNeed,
		childNeeds,
		mainEnvelopeId: main,
		mainExtra: main ? Math.max(0, groupNeed - childNeeds) : 0,
		childrenOverBy: Math.max(0, childAsk - target),
	};
}

/** Header: "Wants · planned 30% · spent 31%" in basis points; null without a base. */
export function groupShares(p: {
	target: GroupTarget;
	targetAmount: Minor | null;
	base: Minor | null;
	/** Spent and shares minus refunds in the group, not Wealth moves (positive). */
	spending: Minor;
}): { plannedBp: number | null; spentBp: number | null } {
	if (p.base == null || p.base <= 0) return { plannedBp: null, spentBp: null };
	const plannedBp =
		p.target.kind === "PERCENT_OF_INCOME"
			? p.target.value
			: p.targetAmount == null
				? null
				: ratioBp(p.targetAmount, p.base);
	return { plannedBp, spentBp: ratioBp(p.spending, p.base) };
}
