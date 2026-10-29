import { buildWealthView } from "~/features/wealth/server/view-model";
import { normalizeDate } from "~/lib/date";
import { userTransaction } from "~/server/db-tx";
import { FigureUnavailable } from "~/server/figures/unavailable";
import { loadAccountsLedger } from "~/server/services/accounts/load";
import { runwayStats } from "~/server/services/accounts/runway";
import { dayOf } from "~/server/services/accounts/series";
import { toMinor } from "~/server/services/envelope/units";
import { owedOnce } from "~/server/services/payments/figures";
import { WealthService } from "~/server/services/wealth.service";
import type { Caller } from "../caller";
import { notTrackedOn } from "./net-worth";

/**
 * The Wealth page's totals for API v1. The groups, allocation, liquid,
 * runway and 30-day change are the web page's own view model
 * (features/wealth/server/view-model.ts) over the same dashboard and runway
 * services, so both clients show the same numbers. Owed and Not tracked are
 * the figures registry's own. Everything is Money; the client only formats.
 */
export async function wealthSummary(caller: Caller) {
	const userId = caller.principal.userId;
	const { homeCurrency: home } = await caller.db.user.findUniqueOrThrow({
		where: { id: userId },
		select: { homeCurrency: true },
	});
	const [dashboard, runway] = await Promise.all([
		new WealthService(caller.db).getDashboardSummary(userId, home),
		runwayStats(caller.db, userId, home),
	]);
	const view = buildWealthView({
		home,
		today: new Date().toISOString().slice(0, 10),
		dashboard,
		averageMonthlySpend: runway.averageMonthlySpend,
		rateTypes: {},
		ratesUpdated: null,
		hideAmounts: false,
	});
	const slots = new Map(view.allocation.map((s) => [s.key, s.series ?? null]));

	// The figures run in one transaction under RLS: Owed uses raw queries.
	const { owed, notTracked } = await userTransaction(
		caller.db,
		userId,
		async (tx) => {
			const people = await owedOnce(tx, userId);
			const ledger = await loadAccountsLedger(tx, userId);
			const today = dayOf(normalizeDate(new Date()));
			let held = 0;
			let missing = false;
			for (const nt of ledger.notTracked) {
				const v = notTrackedOn(nt, today, home, ledger.pick);
				if (v === null) missing = true;
				else held += toMinor(v, home);
			}
			return {
				owed:
					people instanceof FigureUnavailable
						? null
						: {
								toYou: { minor: people.owedToYou, currency: people.currency },
								youOwe: { minor: people.youOwe, currency: people.currency },
							},
				notTracked: missing ? null : { minor: held, currency: home },
			};
		},
	);

	return {
		home,
		netWorth: view.netWorth,
		change: view.change30
			? {
					days: 30,
					total: view.change30.amount,
					basis: view.change30.basis,
				}
			: null,
		groups: view.groups.map((g) => ({
			key: g.key,
			total: g.total,
			series: slots.get(g.key) ?? null,
		})),
		allocation: view.allocation.map((s) => ({
			key: s.key as (typeof view.groups)[number]["key"],
			value: s.value,
			share: s.share,
			series: s.series ?? 0,
		})),
		liquid: view.liquid,
		runway: view.runway,
		owed,
		notTracked,
		missingRates: view.missingRates,
	};
}
