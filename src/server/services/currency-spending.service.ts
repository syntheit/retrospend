import { missingRatesIn, sumInDec } from "@retrospend/domain/money-dec";
import type { Money } from "@retrospend/domain/money-minor";
import { userTransaction } from "~/server/db-tx";
import { findExchangeRate } from "~/server/exchange-rates";
import { decimalMoney } from "~/server/services/expense-list/money";
import { spentByCurrency, spentItems } from "~/server/services/figures/spent";
import type { PrismaClient } from "~prisma";

export type CurrencySpending = {
	currency: string;
	home: string;
	/** Expenses counted: yours, shares included, refunds not. */
	count: number;
	/** Spent in the currency itself, net of refunds; never converted. */
	original: Money;
	/**
	 * The same spending in the home currency under the totals rule (booked
	 * values as saved, the rest at today's rate); null when a rate is missing.
	 */
	inHome: Money | null;
};

/**
 * What the caller spent in one original currency, all time, from spent() the
 * one spending definition (so it matches Activity's footer for the same
 * filter). A missing rate leaves the home figure out; it is never 1.
 */
export async function readCurrencySpending(
	db: PrismaClient,
	userId: string,
	currency: string,
	now: Date = new Date(),
): Promise<CurrencySpending> {
	return userTransaction(db, userId, async (tx) => {
		const user = await tx.user.findUnique({
			where: { id: userId },
			select: { homeCurrency: true },
		});
		const home = user?.homeCurrency ?? "USD";
		const filter = { userId, currencies: [currency] };
		const [items, byCurrency, homeRate] = await Promise.all([
			spentItems(tx, filter),
			spentByCurrency(tx, filter),
			findExchangeRate(tx, home, now),
		]);
		const original = byCurrency.find((m) => m.currency === currency) ?? {
			minor: 0,
			currency,
		};
		const rate = homeRate?.rate ?? null;
		const missing = missingRatesIn(items, home, rate);
		return {
			currency,
			home,
			count: items.reduce((n, i) => n + i.count, 0),
			original,
			inHome: missing.length
				? null
				: decimalMoney(sumInDec(items, home, rate), home),
		};
	});
}
