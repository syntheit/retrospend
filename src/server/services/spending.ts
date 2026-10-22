/**
 * The named row filters behind every spending number (budget build plan §5.5).
 * The numbers themselves come from `figures/spent.ts`; nothing else builds a
 * spending where clause, so money in can never reach a total by accident.
 *
 * - Reports (stats, dashboard, Insights, exports): your OUT STANDARD rows,
 *   honoring "Hide from reports" (`excludeFromAnalytics`); amortized
 *   purchases count through their monthly parts. Refunds net against them.
 * - Budget (the envelope engine only): the same rows including hidden ones,
 *   by amortization mode. The cash left, so the budget always sees it.
 * - Income (`inType = INCOME`), NOT_SPENDING, STARTING_BALANCE and
 *   ADJUSTMENT rows are in neither.
 */
import type { Prisma } from "~prisma";

export type DateRange = { gte?: Date; lte?: Date };

const outflows = (userId: string, date?: DateRange) => ({
	userId,
	status: "FINALIZED" as const,
	direction: "OUT" as const,
	entryKind: "STANDARD" as const,
	...(date ? { date } : {}),
});

/** Personal rows that count as spending in reports. */
export function reportSpendingWhere(
	userId: string,
	date?: DateRange,
): Prisma.ExpenseWhereInput {
	return {
		...outflows(userId, date),
		isAmortizedParent: false,
		excludeFromAnalytics: false,
	};
}

/** Refunds that net against report spending, in the refund's own month (D27). */
export function reportRefundWhere(
	userId: string,
	date?: DateRange,
): Prisma.ExpenseWhereInput {
	return {
		userId,
		status: "FINALIZED",
		direction: "IN",
		entryKind: "STANDARD",
		inType: "REFUND",
		excludeFromAnalytics: false,
		...(date ? { date } : {}),
	};
}

/**
 * Personal rows the budget counts: hidden-from-reports rows included.
 * INSTALLMENTS purchases count each monthly part; REPORTS_ONLY purchases
 * count in full at purchase, so their parts are skipped.
 */
export function budgetSpendingWhere(
	userId: string,
	date?: DateRange,
): Prisma.ExpenseWhereInput {
	return {
		...outflows(userId, date),
		OR: [
			{ isAmortizedParent: false, isAmortizedChild: false },
			{
				isAmortizedChild: true,
				parent: { is: { amortizeMode: "INSTALLMENTS" } },
			},
			{ isAmortizedParent: true, amortizeMode: "REPORTS_ONLY" },
		],
	};
}

/** Refunds the budget counts: like budget spending, hidden ones included. */
export function budgetRefundWhere(
	userId: string,
	date?: DateRange,
): Prisma.ExpenseWhereInput {
	const { excludeFromAnalytics: _hidden, ...refunds } = reportRefundWhere(
		userId,
		date,
	);
	return refunds;
}

/**
 * Money in the budget counts (budget SPEC §5.2, §12.3): income entering To
 * assign, the starting balance and adjustments. Refunds are envelope
 * Activity (budgetRefundWhere); own transfers (NOT_SPENDING) are nothing.
 */
export function budgetMoneyInWhere(
	userId: string,
	from: Date,
): Prisma.ExpenseWhereInput {
	return {
		userId,
		status: "FINALIZED",
		date: { gte: from },
		OR: [
			{ direction: "IN", entryKind: "STANDARD", inType: "INCOME" },
			{ entryKind: { in: ["STARTING_BALANCE", "ADJUSTMENT"] } },
		],
	};
}

/**
 * Rows today's expense lists, duplicate checks and title suggestions know how
 * to show: spending entries only. Money in, own transfers and adjustments
 * wait for the Activity rebuild, which labels them.
 */
export function listedEntryWhere(userId: string): Prisma.ExpenseWhereInput {
	return { userId, direction: "OUT", entryKind: "STANDARD" };
}
