import type { Prisma, PrismaClient } from "~prisma";
import { fromUSD } from "~/server/currency";

/**
 * Fetches the best available exchange rate for a currency on or before a given date.
 * Priority: "blue" > "official" > first available.
 */
export async function getBestExchangeRate(
	db: PrismaClient,
	currency: string,
	date: Date,
): Promise<{ rate: number; type: string } | null> {
	if (currency === "USD") return { rate: 1, type: "official" };

	const rates = await db.exchangeRate.findMany({
		where: {
			currency,
			date: { lte: date },
		},
		orderBy: [{ date: "desc" }, { type: "asc" }],
		take: 10,
	});

	if (rates.length === 0) return null;

	// Priority: blue > official > crypto > first available
	const blueRate = rates.find((r) => r.type === "blue");
	if (blueRate) return { rate: blueRate.rate.toNumber(), type: "blue" };

	const officialRate = rates.find((r) => r.type === "official");
	if (officialRate)
		return { rate: officialRate.rate.toNumber(), type: "official" };

	const cryptoRate = rates.find((r) => r.type === "crypto");
	if (cryptoRate) return { rate: cryptoRate.rate.toNumber(), type: "crypto" };

	const first = rates[0];
	return first ? { rate: first.rate.toNumber(), type: first.type } : null;
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
