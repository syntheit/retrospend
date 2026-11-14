/**
 * Plan cost and runway (SPEC §5.13, E6, B15, D55).
 */
import { type MonthlyTarget, monthlyTargetFor } from "./targets";
import type { Minor } from "./types";
import { ceilDiv, sumMinor } from "./units";

export type PlanCostTarget =
	| { kind: "MONTHLY"; target: MonthlyTarget; weeksInMonth: number }
	| {
			kind: "BILL";
			amount: Minor;
			repeatMonths: number | null;
			needThisMonth: Minor;
	  }
	| { kind: "SAVINGS"; monthlyNeed: Minor }
	| { kind: "NONE" };

/** Monthly equivalent of one target (SPEC §5.13 plan cost). */
export function monthlyEquivalent(t: PlanCostTarget): Minor {
	if (t.kind === "MONTHLY") return monthlyTargetFor(t.target, t.weeksInMonth);
	if (t.kind === "BILL")
		return t.repeatMonths ? ceilDiv(t.amount, t.repeatMonths) : t.needThisMonth;
	if (t.kind === "SAVINGS") return t.monthlyNeed;
	return 0;
}

/**
 * Plan cost: Σ monthly equivalents, where a group counts its own target
 * when that is larger than its children (SPEC §5.13, E6).
 */
export function planCost(
	envelopes: ReadonlyArray<{
		id: string;
		groupId: string | null;
		target: PlanCostTarget;
	}>,
	groupTargets: ReadonlyMap<string, Minor>,
): { total: Minor; byGroup: Map<string | null, Minor> } {
	const children = new Map<string | null, Minor[]>();
	for (const e of envelopes) {
		const list = children.get(e.groupId) ?? [];
		list.push(monthlyEquivalent(e.target));
		children.set(e.groupId, list);
	}
	for (const g of groupTargets.keys())
		if (!children.has(g)) children.set(g, []);
	const byGroup = new Map<string | null, Minor>();
	for (const [g, list] of children) {
		const own = sumMinor(list);
		const target = g === null ? 0 : (groupTargets.get(g) ?? 0);
		byGroup.set(g, Math.max(own, target));
	}
	return { total: sumMinor(byGroup.values()), byGroup };
}

/**
 * What savings goals hold outside their envelopes: money moved to Wealth
 * (ToWealth - FromWealth), or a dedicated account's value today. Their
 * envelope Left is already in Σ Left, so it is not counted here.
 */
export function savingsOutsideEnvelopes(
	goals: ReadonlyArray<{
		toWealth: Minor;
		fromWealth: Minor;
		dedicatedAccountValue?: Minor | null;
	}>,
): Minor {
	return sumMinor(
		goals.map((g) =>
			g.dedicatedAccountValue != null
				? g.dedicatedAccountValue
				: g.toWealth - g.fromWealth,
		),
	);
}

export interface Runway {
	/** To assign + Σ Left + savings outside envelopes. */
	available: Minor;
	/** Whole tenths of a month, rounded down ("7.5 months" = 75). */
	tenths: number;
}

/**
 * Runway (SPEC §5.13, B15, D55): how long the budget and savings last at the
 * essential plan cost. Savings Left counts once, through Σ Left; only money
 * goals hold outside their envelopes is added. Rounded down so it never
 * promises more time than there is. Null when the plan costs nothing.
 */
export function runway(r: {
	toAssign: Minor;
	sumLeft: Minor;
	savingsOutside: Minor;
	essentialPlanCost: Minor;
}): Runway | null {
	if (r.essentialPlanCost <= 0) return null;
	const available = r.toAssign + r.sumLeft + r.savingsOutside;
	if (available <= 0) return { available, tenths: 0 };
	const tenths = (BigInt(available) * 10n) / BigInt(r.essentialPlanCost);
	return { available, tenths: Number(tenths) };
}
