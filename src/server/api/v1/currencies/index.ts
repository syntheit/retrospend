import * as currencies from "~/server/services/api-v1/currencies";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const c = v1.currencies;

/** Rates are shared data; the caller's client is used only to stay on one path. */
export const currenciesRouter = {
	list: c.list.handler(
		serve(({ context, input }) =>
			currencies.listCurrencyPage(signedIn(context).db, input),
		),
	),
	listRates: c.listRates.handler(
		serve(({ context, input }) =>
			currencies.listRatePage(signedIn(context).db, input),
		),
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
	bestRate: c.bestRate.handler(
		serve(({ context, input }) => {
			const { currency, ...query } = input;
			return currencies.readBestRate(signedIn(context).db, currency, query);
		}),
	),
	syncStatus: c.syncStatus.handler(
		serve(({ context }) => currencies.readSyncStatus(signedIn(context).db)),
	),
	// The admin scope (admins only) is checked before the handler runs.
	sync: c.sync.handler(serve(() => currencies.startRateSync())),
};
