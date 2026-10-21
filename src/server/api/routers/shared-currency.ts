import { sumIn } from "~/lib/money";
import type { Prisma, PrismaClient } from "~prisma";
import { findExchangeRate } from "~/server/exchange-rates";

/**
 * Fetches the best available exchange rate for a currency on a given date.
 * Priority: "blue" > "official" > "crypto" > first available. Falls back to
 * the nearest rate after the date when none exists on or before it.
 */
export async function getBestExchangeRate(
	db: PrismaClient,
	currency: string,
	date: Date,
): Promise<{ rate: number; type: string } | null> {
	return findExchangeRate(db, currency, date);
}

/**
 * Sums finalized, non-excluded expenses in `targetCurrency` by the totals
 * rule (~/lib/money): same-currency amounts as entered, the rest from
 * amountInUSD at the target currency's rate on `date`. Also returns the USD
 * total.
 */
export async function sumExpensesForCurrency(
	db: PrismaClient,
	where: Prisma.ExpenseWhereInput,
	targetCurrency: string,
	date: Date = new Date(),
) {
	const [expenses, bestRate] = await Promise.all([
		db.expense.findMany({
			where: { ...where, status: "FINALIZED", excludeFromAnalytics: false },
			select: { amount: true, currency: true, amountInUSD: true },
		}),
		getBestExchangeRate(db, targetCurrency, date),
	]);

	const items = expenses.map((e) => ({
		amount: Number(e.amount),
		currency: e.currency,
		amountInUSD: Number(e.amountInUSD),
	}));

	return {
		total: sumIn(items, targetCurrency, bestRate?.rate),
		totalInUSD: items.reduce((sum, e) => sum + e.amountInUSD, 0),
	};
}
