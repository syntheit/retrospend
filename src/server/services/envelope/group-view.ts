/**
 * Group targets on the month view (SPEC §5.9, owner Q6, 50/30/20): the
 * target as stored, and the header the Budget page shows ("Wants · planned
 * 30% · spent 31%") with the group need Use my plan fills. The math lives in
 * groups.ts; this shapes it for the DTO.
 */
import type { GroupTargetDto, Money } from "~/lib/schemas/envelope";
import type { Prisma } from "~prisma";
import {
	type BaseSource,
	type GroupMember,
	type GroupTarget,
	groupPlan,
	groupShares,
	groupTargetAmount,
} from "./groups";
import type { Minor } from "./types";
import { dec, sumMinor, toMinor } from "./units";

/** The base for % targets this month, or null before any income exists. */
export interface GroupBase {
	base: Minor;
	source: BaseSource;
	/** A row of the base had no rate: left out, flagged (R14). */
	incomplete: boolean;
}

export interface GroupMemberView extends GroupMember {
	/** Spent and shares minus refunds, not Wealth moves (positive = spent). */
	spending: Minor;
}

interface StoredGroup {
	targetKind: "NONE" | "AMOUNT" | "PERCENT_OF_INCOME";
	targetValue: Prisma.Decimal | null;
	mainEnvelopeId: string | null;
}

/** A stored group target: an amount in H minor units, or a percent (30.0) as basis points. */
export function groupTargetOf(
	g: StoredGroup,
	H: string,
): { target: GroupTarget | null; mainEnvelopeId: string | null } {
	const value = g.targetValue;
	if (g.targetKind === "NONE" || value === null)
		return { target: null, mainEnvelopeId: g.mainEnvelopeId };
	return {
		target: {
			kind: g.targetKind,
			value:
				g.targetKind === "AMOUNT"
					? toMinor(value, H)
					: dec(value).times(100).toDecimalPlaces(0).toNumber(),
		},
		mainEnvelopeId: g.mainEnvelopeId,
	};
}

/**
 * The group header and need for an open month; null without a target or
 * for a closed month (`base` undefined), which shows what happened instead.
 */
export function groupTargetDto(
	g: { target?: GroupTarget | null; mainEnvelopeId?: string | null } | null,
	members: readonly GroupMemberView[],
	base: GroupBase | null | undefined,
	money: (v: Minor) => Money,
): GroupTargetDto | null {
	const t = g?.target;
	if (!t || t.kind === "NONE" || base === undefined) return null;
	const amount = groupTargetAmount(t, base?.base ?? null);
	const plan =
		amount === null ? null : groupPlan(amount, members, g?.mainEnvelopeId);
	const shares = groupShares({
		target: t,
		targetAmount: amount,
		base: base?.base ?? null,
		spending: Math.max(0, sumMinor(members.map((m) => m.spending))),
	});
	return {
		kind: t.kind,
		amount: amount === null ? null : money(amount),
		basisPoints: t.kind === "PERCENT_OF_INCOME" ? t.value : null,
		base: base ? money(base.base) : null,
		baseSource: base?.source ?? null,
		plannedBp: shares.plannedBp,
		spentBp: shares.spentBp,
		need: money(plan?.groupNeed ?? 0),
		mainEnvelopeId: plan?.mainEnvelopeId ?? null,
		mainExtra: money(plan?.mainExtra ?? 0),
		childrenOverBy: money(plan?.childrenOverBy ?? 0),
		incomplete: base?.incomplete ?? false,
	};
}
