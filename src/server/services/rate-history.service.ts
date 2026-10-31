import {
	buildRateHistory,
	type HistoryRow,
} from "~/features/currencies/server/history";
import type { HistoryRange, RateHistory } from "~/features/currencies/types";
import { userTransaction } from "~/server/db-tx";
import { homeCurrencyOf } from "~/server/services/accounts/ledger";
import type { PrismaClient } from "~prisma";

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * A currency's rate history against the caller's home currency, priced like
 * the Currencies page. Reads the stored days (exchange_rate_history) plus the
 * newest rates (exchange_rate), so a sync the history has not recorded yet
 * still shows. Rates are shared data; only the home currency is the caller's.
 */
export async function readRateHistory(
	db: PrismaClient,
	userId: string,
	code: string,
	range: HistoryRange,
	now: Date = new Date(),
): Promise<RateHistory> {
	const home = await userTransaction(db, userId, (tx) =>
		homeCurrencyOf(tx, userId),
	);
	const currencies = [...new Set([code, home])];
	const [stored, newest] = await Promise.all([
		db.exchangeRateHistory.findMany({
			where: { currency: { in: currencies } },
			select: { date: true, currency: true, type: true, rate: true },
		}),
		db.exchangeRate.findMany({
			where: { currency: { in: currencies } },
			select: { date: true, currency: true, type: true, rate: true },
		}),
	]);
	// The newest row of each type wins over a stored day it shares.
	const rows: HistoryRow[] = [...stored, ...newest].map((r) => ({
		currency: r.currency,
		type: r.type,
		day: isoDay(r.date),
		rate: r.rate,
	}));
	return buildRateHistory({ code, home, rows, range, today: isoDay(now) });
}
