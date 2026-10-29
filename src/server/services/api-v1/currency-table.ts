import type {
	ConversionDto,
	ConvertDirection,
	RateTableDto,
} from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import {
	buildCurrenciesView,
	convert,
} from "~/features/currencies/server/view-model";
import { userTransaction } from "~/server/db-tx";
import { homeCurrencyOf } from "~/server/services/accounts/ledger";
import {
	getRateSyncStatus,
	listLatestRates,
} from "~/server/services/exchange-rate.service";
import { listFavoriteRates } from "~/server/services/rate-favorites.service";
import { type Caller, isoDay } from "./caller";

/**
 * v1 adapters for the Currencies screen: the same pricing the web page runs
 * (src/features/currencies/server), so every client shows the server's
 * figures. Nothing here computes a price of its own.
 */

/** As many rate rows as the web page reads (one per currency and type). */
const RATE_ROWS = 1000;

async function latestRates(caller: Caller) {
	const rows = await listLatestRates(caller.db, { take: RATE_ROWS });
	return rows.map((r) => ({
		id: r.id,
		currency: r.currency,
		type: r.type,
		rate: r.rate,
	}));
}

/** The caller's home currency and open accounts, read under their RLS. */
function homeAndAccounts(caller: Caller) {
	const userId = caller.principal.userId;
	return userTransaction(caller.db, userId, async (tx) => ({
		home: await homeCurrencyOf(tx, userId),
		accounts: await tx.assetAccount.findMany({
			where: { userId, closedAt: null },
			select: { name: true, currency: true },
			orderBy: { createdAt: "asc" },
		}),
	}));
}

export async function readRateTable(caller: Caller): Promise<RateTableDto> {
	const [{ home, accounts }, rates, favorites, sync] = await Promise.all([
		homeAndAccounts(caller),
		latestRates(caller),
		listFavoriteRates(caller.db, caller.principal.userId),
		getRateSyncStatus(caller.db),
	]);
	const view = buildCurrenciesView({
		home,
		rates,
		favorites: favorites.map((f) => ({
			id: f.exchangeRateId,
			currency: f.exchangeRate.currency,
		})),
		accounts,
		updated: sync.latestRateDate ? isoDay(sync.latestRateDate) : null,
	});
	return {
		...view,
		rows: view.rows.map(({ types, prices, derived, ...row }) => ({
			...row,
			rates: types.map((type) => ({
				type,
				price: prices[type] ?? null,
				derived: derived.includes(type),
			})),
		})),
	};
}

/**
 * An amount at every rate type of a currency, to or from home. A currency
 * with no rate (or the home currency itself) has no results, never a 1.
 */
export async function convertAmount(
	caller: Caller,
	input: { currency: string; amount: number; direction: ConvertDirection },
): Promise<ConversionDto> {
	const userId = caller.principal.userId;
	const [home, rates] = await Promise.all([
		userTransaction(caller.db, userId, (tx) => homeCurrencyOf(tx, userId)),
		latestRates(caller),
	]);
	const from = input.direction === "toHome" ? input.currency : home;
	const results =
		input.currency === home
			? []
			: convert(rates, home, input.currency, input.amount, input.direction);
	if (results.some((r) => !Number.isSafeInteger(r.value.minor)))
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "The converted amount is too large",
		});
	return { from: { minor: input.amount, currency: from }, results };
}
