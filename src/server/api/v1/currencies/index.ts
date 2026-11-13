import * as currencies from "~/server/services/api-v1/currencies";
import {
	convertAmount,
	readRateTable,
} from "~/server/services/api-v1/currency-table";
import * as rateSync from "~/server/services/api-v1/rate-sync";
import { readCurrencySpending } from "~/server/services/currency-spending.service";
import { readRateHistory } from "~/server/services/rate-history.service";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const c = v1.currencies;

/**
 * Rates are shared data. The raw rate reads run on the global client inside
 * the service, because raw SQL is refused on a scoped client. The rate table
 * and the converter also read the caller's home currency, favorites and
 * accounts, under their RLS.
 */
export const currenciesRouter = {
	list: c.list.handler(
		serve(({ context, input }) => {
			signedIn(context);
			return currencies.listCurrencyPage(input);
		}),
	),
	listRates: c.listRates.handler(
		serve(({ context, input }) => {
			signedIn(context);
			return currencies.listRatePage(input);
		}),
	),
	rateHistory: c.rateHistory.handler(
		serve(({ context, input }) => {
			const { currency, ...query } = input;
			return currencies.listRateHistoryPage(
				signedIn(context).db,
				currency,
				query,
			);
		}),
	),
	dailyRates: c.dailyRates.handler(
		serve(async ({ context }) => {
			const { body, etag } = await rateSync.readDailyRates(
				signedIn(context).db,
			);
			context.resHeaders?.set("etag", etag);
			return body;
		}),
	),
	historyRates: c.historyRates.handler(
		serve(({ context, input }) =>
			rateSync.listHistoryRatePage(signedIn(context).db, input),
		),
	),
	bestRate: c.bestRate.handler(
		serve(({ context, input }) => {
			const { currency, ...query } = input;
			return currencies.readBestRate(signedIn(context).db, currency, query);
		}),
	),
	rateTable: c.rateTable.handler(
		serve(({ context }) => readRateTable(signedIn(context))),
	),
	rateSeries: c.rateSeries.handler(
		serve(({ context, input }) => {
			const caller = signedIn(context);
			return readRateHistory(
				caller.db,
				caller.principal.userId,
				input.currency,
				input.range,
			);
		}),
	),
	currencySpending: c.currencySpending.handler(
		serve(({ context, input }) => {
			const caller = signedIn(context);
			return readCurrencySpending(
				caller.db,
				caller.principal.userId,
				input.currency,
			);
		}),
	),
	convert: c.convert.handler(
		serve(({ context, input }) => convertAmount(signedIn(context), input)),
	),
	syncStatus: c.syncStatus.handler(
		serve(({ context }) => currencies.readSyncStatus(signedIn(context).db)),
	),
	// The admin scope (admins only) is checked before the handler runs.
	sync: c.sync.handler(serve(() => currencies.startRateSync())),
};
