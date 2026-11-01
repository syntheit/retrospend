import {
	buildRateHistory,
	type HistoryRow,
	rangeStart,
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
	const today = isoDay(now);
	const start = rangeStart(range, today);
	const select = { date: true, currency: true, type: true, rate: true };
	const where = { currency: { in: currencies } };
	// Only the range's days, plus the newest earlier day of each currency and
	// type, which a series falls back to before its first stored day.
	const [stored, lookback, newest] = await Promise.all([
		db.exchangeRateHistory.findMany({
			where: start ? { ...where, date: { gte: new Date(start) } } : where,
			select,
		}),
		start
			? db.exchangeRateHistory.findMany({
					where: { ...where, date: { lt: new Date(start) } },
					distinct: ["currency", "type"],
					orderBy: { date: "desc" },
					select,
				})
			: Promise.resolve([]),
		db.exchangeRate.findMany({ where, select }),
	]);
	// The newest row of each type wins over a stored day it shares.
	const rows: HistoryRow[] = [...lookback, ...stored, ...newest].map((r) => ({
		currency: r.currency,
		type: r.type,
		day: isoDay(r.date),
		rate: r.rate,
	}));
	return buildRateHistory({ code, home, rows, range, today });
}
