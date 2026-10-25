import { sumIn } from "~/lib/money";
import type { PrismaClient } from "~prisma";
import { getBestExchangeRate } from "../api/routers/shared-currency";
import { spentItems } from "./figures/spent";

/**
 * Lifetime spending in the home currency. The total follows the totals rule
 * in ~/lib/money: home-currency expenses count as entered, the rest convert
 * from amountInUSD at today's home rate.
 */
export class StatsService {
	constructor(private db: PrismaClient) {}

	async getLifetimeStats(userId: string, homeCurrency: string) {
		// Lifetime has always counted personal rows only; shares stay out so
		// the number people know does not move. Refunds lower the total but
		// are not transactions (spent items count them 0), like the profile's
		// entry count.
		const [items, rate] = await Promise.all([
			spentItems(this.db, { userId, personalOnly: true }, "currency"),
			getBestExchangeRate(this.db, homeCurrency, new Date()).then(
				(r) => r?.rate ?? null,
			),
		]);

		return {
			totalSpent: sumIn(items, homeCurrency, rate),
			totalTransactions: items.reduce((n, item) => n + item.count, 0),
		};
	}
}
