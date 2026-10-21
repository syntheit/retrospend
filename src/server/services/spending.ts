/**
 * The user's spending for totals: personal expenses that count toward
 * analytics plus their shares of shared expenses. Totals follow the totals
 * rule in ~/lib/money (sumIn).
 */
import type { MoneyItem } from "~/lib/money";
import { sumIn } from "~/lib/money";
import type { Prisma, PrismaClient } from "~prisma";
import { getSharedExpenseShares } from "./shared-expense-integration";

type AppDb = PrismaClient | Prisma.TransactionClient;

export type DateRange = { gte?: Date; lte?: Date };

/** Personal expenses that count as spending. */
export function spendingWhere(
	userId: string,
	date?: DateRange,
): Prisma.ExpenseWhereInput {
	return {
		userId,
		status: "FINALIZED",
		isAmortizedParent: false,
		excludeFromAnalytics: false,
		...(date ? { date } : {}),
	};
}

/**
 * Spending in a date range as money items, personal expenses summed per
 * currency and shared shares one by one.
 */
export async function getSpendingItems(
	db: AppDb,
	userId: string,
	date: DateRange,
	excludedProjectIds?: string[],
): Promise<MoneyItem[]> {
	const [personal, shared] = await Promise.all([
		(db as PrismaClient).expense.groupBy({
			by: ["currency"],
			where: spendingWhere(userId, date),
			_sum: { amount: true, amountInUSD: true },
		}),
		getSharedExpenseShares(db, userId, date, undefined, excludedProjectIds),
	]);
	return [
		...personal.map((p) => ({
			currency: p.currency,
			amount: Number(p._sum.amount ?? 0),
			amountInUSD: Number(p._sum.amountInUSD ?? 0),
		})),
		...shared,
	];
}

/** Total spending in a date range, in `currency` at `rate`. */
export async function getSpendingTotal(
	db: AppDb,
	userId: string,
	date: DateRange,
	currency: string,
	rate: number | null | undefined,
	excludedProjectIds?: string[],
): Promise<number> {
	const items = await getSpendingItems(db, userId, date, excludedProjectIds);
	return sumIn(items, currency, rate);
}
