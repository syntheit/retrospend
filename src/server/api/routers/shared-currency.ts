import type { Prisma, PrismaClient } from "~prisma";

/**
 * Fetches the best available exchange rate for a currency on or before a given date.
 * Priority: "blue" > "official" > first available.
 */
export async function getBestExchangeRate(
	db: PrismaClient,
	currency: string,
	date: Date,
): Promise<number | null> {
	if (currency === "USD") return 1;

	const rates = await db.exchangeRate.findMany({
		where: {
			currency,
			date: { lte: date },
		},
		orderBy: [{ date: "desc" }, { type: "asc" }],
		take: 10,
	});

	if (rates.length === 0) return null;

	const blueRate = rates.find((r) => r.type === "blue");
	if (blueRate) return blueRate.rate.toNumber();

	const officialRate = rates.find((r) => r.type === "official");
	if (officialRate) return officialRate.rate.toNumber();

	return rates[0]?.rate.toNumber() ?? null;
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
		where: { ...where, status: "FINALIZED" },
		select: { amount: true, currency: true, amountInUSD: true },
	});

	const rate = (await getBestExchangeRate(db, targetCurrency, date)) ?? 1;
	let total = 0;
	let totalInUSD = 0;

	for (const exp of expenses) {
		const usd = Number(exp.amountInUSD);
		totalInUSD += usd;
		total += exp.currency === targetCurrency ? Number(exp.amount) : usd * rate;
	}

	return { total, totalInUSD };
}
