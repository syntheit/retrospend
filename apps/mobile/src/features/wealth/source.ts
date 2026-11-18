import type { RetrospendClient } from "@retrospend/api-client";
import type { DeviceReads } from "@/data/device-engine";
import type { CacheKey } from "@/features/read/loadCached";

// Wealth reads, all from API v1 (accounts, net worth and the summary). Shapes are the
// contract's own. Every figure, the net worth, its change and each point of
// the series, is the server's; the phone formats and draws them.

type Client = RetrospendClient["accounts"];

export type AccountList = Awaited<ReturnType<Client["list"]>>;
export type Account = AccountList["accounts"][number];
export type AccountOrder = Awaited<ReturnType<Client["order"]>>;
export type NetWorth = Awaited<ReturnType<Client["netWorth"]>>;
export type WealthSummary = Awaited<ReturnType<Client["summary"]>>;
export type SeriesPoint = NetWorth["series"][number];
export type AccountDetail = Awaited<ReturnType<Client["get"]>>;
export type AccountLeg = AccountDetail["legs"][number];
export type BalancePreview = Awaited<
	ReturnType<Client["previewUpdateBalance"]>
>;

export interface WealthData {
	list: AccountList;
	netWorth: NetWorth;
	/** The page's totals the server works out: groups, allocation, liquid, runway. */
	summary: WealthSummary;
	/** How the accounts are sorted and the order you set by dragging, saved per person. */
	order: AccountOrder;
}

/** The longest range the chart offers; one read covers every shorter one. */
export const SERIES_DAYS = 365;
export const CHANGE_DAYS = 30;

export const WEALTH_CACHE: CacheKey = { name: "wealth", schema: 3 };
export const ACCOUNT_CACHE_PREFIX = "account.";

export function accountCache(id: string): CacheKey {
	return { name: `${ACCOUNT_CACHE_PREFIX}${id}`, schema: 1 };
}

/**
 * The device's figures are only checked against the server's, in the
 * background, with the account ids the screen lists: it shows the server's
 * numbers (AGENTS 6.1).
 */
export function fetchWealth(
	api: RetrospendClient,
	device?: DeviceReads | null,
) {
	return async (): Promise<WealthData> => {
		const [list, netWorth, summary, order] = await Promise.all([
			api.accounts.list(),
			api.accounts.netWorth({ days: SERIES_DAYS, changeDays: CHANGE_DAYS }),
			api.accounts.summary(),
			api.accounts.order(),
		]);
		if (device)
			void device.compare("wealth", {
				accountId: list.accounts.map((a) => a.id),
			});
		return { list, netWorth, summary, order };
	};
}

export function fetchAccount(api: RetrospendClient, id: string) {
	return () => api.accounts.get({ id });
}

export type CurrencyInfo = Awaited<
	ReturnType<RetrospendClient["currencies"]["list"]>
>["items"][number];

export const CURRENCY_INFO_CACHE: CacheKey = {
	name: "wealth.currencies",
	schema: 1,
};

/** Every currency the server knows with the rate types it stores for each. */
export function fetchCurrencyInfo(api: RetrospendClient) {
	return async (): Promise<CurrencyInfo[]> =>
		(await api.currencies.list({ limit: 200 })).items;
}
