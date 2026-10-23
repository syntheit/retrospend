import "server-only";

import { api } from "~/trpc/server";
import type { WealthView } from "../types";
import { buildWealthView } from "./view-model";

/** Rate types the server has, per currency (latest row of each). */
export function rateTypesByCurrency(
	rates: readonly { currency: string; type: string }[],
): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	for (const r of rates) {
		const list = out[r.currency] ?? [];
		if (!list.includes(r.type)) list.push(r.type);
		out[r.currency] = list;
	}
	return out;
}

/**
 * Reads today's wealth procedures for the signed-in user (the RSC caller
 * runs them under the request's session and RLS) and builds the page view.
 */
export async function loadWealthView(): Promise<WealthView> {
	const settings = await api.settings.getGeneral();
	const home = settings.homeCurrency;
	const [dashboard, runway, rates, lastSync] = await Promise.all([
		api.wealth.getDashboard({ currency: home }),
		api.wealth.getRunwayStats({ currency: home }),
		api.exchangeRate.getAllRates(),
		api.exchangeRate.getLastSync(),
	]);
	return buildWealthView({
		home,
		today: new Date().toISOString().slice(0, 10),
		dashboard,
		averageMonthlySpend: runway.averageMonthlySpend,
		rateTypes: rateTypesByCurrency(rates),
		ratesUpdated: lastSync ? lastSync.toISOString().slice(0, 10) : null,
		hideAmounts: settings.defaultPrivacyMode,
	});
}
