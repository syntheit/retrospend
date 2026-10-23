import "server-only";

import { api } from "~/trpc/server";
import type { CurrenciesView } from "../types";
import { buildCurrenciesView } from "./view-model";

/** The latest rate per currency and type, as the rate table serves it. */
export async function loadRates() {
	const rates = await api.exchangeRate.getAllRates();
	return rates.map((r) => ({
		id: r.id,
		currency: r.currency,
		type: r.type,
		rate: r.rate.toString(),
	}));
}

/**
 * Reads the rate table, the user's favorites and open accounts (for the
 * currencies they use) through today's procedures under the request's
 * session, and prices everything on the server.
 */
export async function loadCurrenciesView(): Promise<CurrenciesView> {
	const settings = await api.settings.getGeneral();
	const home = settings.homeCurrency;
	const [rates, favorites, dashboard, lastSync] = await Promise.all([
		loadRates(),
		api.preferences.getFavoriteExchangeRates(),
		api.wealth.getDashboard({ currency: home }),
		api.exchangeRate.getLastSync(),
	]);
	return buildCurrenciesView({
		home,
		rates,
		favorites: favorites.map((f) => ({ id: f.id, currency: f.rate.currency })),
		accounts: dashboard.assets.map((a) => ({
			name: a.name,
			currency: a.currency,
		})),
		updated: lastSync ? lastSync.toISOString().slice(0, 10) : null,
	});
}
