import type { Prisma, PrismaClient } from "~prisma";
import { fromUSD } from "~/server/currency";
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
 * Sums expenses with same-currency awareness.
 * Same-currency = original amount. Cross-currency = convert via USD.
 * Returns both the target currency total and the USD total.
 */
export async function sumExpensesForCurrency(
	db: PrismaClient,
	where: Prisma.ExpenseWhereInput,
	targetCurrency: string,
	date: Date = new Date(),
) {
	const expenses = await db.expense.findMany({
		where: { ...where, status: "FINALIZED", excludeFromAnalytics: false },
		select: { amount: true, currency: true, amountInUSD: true },
	});

	const bestRate = await getBestExchangeRate(db, targetCurrency, date);
	const rate = bestRate?.rate ?? 1;

	let total = 0;
	let totalInUSD = 0;

	for (const exp of expenses) {
		const usd = Number(exp.amountInUSD);
		totalInUSD += usd;
		if (exp.currency === targetCurrency) {
			total += Number(exp.amount);
		} else {
			total += fromUSD(usd, targetCurrency, rate);
		}
	}

	return { total, totalInUSD };
}
