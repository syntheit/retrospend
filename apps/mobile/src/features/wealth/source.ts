import type { RetrospendClient } from "@retrospend/api-client";
import type { CacheKey } from "@/features/read/loadCached";

// Wealth reads, all from API v1 (accounts and net worth). Shapes are the
// contract's own. Every figure, the net worth, its change and each point of
// the series, is the server's; the phone formats and draws them.

type Client = RetrospendClient["accounts"];

export type AccountList = Awaited<ReturnType<Client["list"]>>;
export type Account = AccountList["accounts"][number];
export type NetWorth = Awaited<ReturnType<Client["netWorth"]>>;
export type SeriesPoint = NetWorth["series"][number];
export type AccountDetail = Awaited<ReturnType<Client["get"]>>;
export type AccountLeg = AccountDetail["legs"][number];
export type BalancePreview = Awaited<
	ReturnType<Client["previewUpdateBalance"]>
>;

export interface WealthData {
	list: AccountList;
	netWorth: NetWorth;
}

/** The longest range the chart offers; one read covers every shorter one. */
export const SERIES_DAYS = 365;
export const CHANGE_DAYS = 30;

export const WEALTH_CACHE: CacheKey = { name: "wealth", schema: 1 };
export const ACCOUNT_CACHE_PREFIX = "account.";
export const ACCOUNT_CACHE_KEEP = 20;

export function accountCache(id: string): CacheKey {
	return { name: `${ACCOUNT_CACHE_PREFIX}${id}`, schema: 1 };
}

export function fetchWealth(api: RetrospendClient) {
	return async (): Promise<WealthData> => {
		const [list, netWorth] = await Promise.all([
			api.accounts.list(),
			api.accounts.netWorth({ days: SERIES_DAYS, changeDays: CHANGE_DAYS }),
		]);
		return { list, netWorth };
	};
}

export function fetchAccount(api: RetrospendClient, id: string) {
	return () => api.accounts.get({ id });
}
