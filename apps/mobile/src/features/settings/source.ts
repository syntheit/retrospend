import type { RetrospendClient } from "@retrospend/api-client";
import type { CacheKey } from "@/features/read/loadCached";

// Settings reads, all from API v1. Shapes are the contract's own.

export type Profile = Awaited<ReturnType<RetrospendClient["profile"]["get"]>>;
export type GeneralSettings = Awaited<
	ReturnType<RetrospendClient["settings"]["get"]>
>;
export type NotificationPreference = Awaited<
	ReturnType<RetrospendClient["notifications"]["getPreferences"]>
>["preferences"][number];
export type NotificationType = NotificationPreference["type"];
export type FavoriteRate = Awaited<
	ReturnType<RetrospendClient["settings"]["listFavoriteRates"]>
>["items"][number];
export type CurrencyOption = Awaited<
	ReturnType<RetrospendClient["currencies"]["list"]>
>["items"][number];

export const PROFILE_CACHE: CacheKey = { name: "settings.profile", schema: 1 };
export const SETTINGS_CACHE: CacheKey = { name: "settings.general", schema: 1 };
export const NOTIFICATIONS_CACHE: CacheKey = {
	name: "settings.notifications",
	schema: 1,
};
export const RATES_CACHE: CacheKey = { name: "settings.rates", schema: 1 };
export const CURRENCIES_CACHE: CacheKey = {
	name: "settings.currencies",
	schema: 1,
};

/** The newest 200 fiat currencies the server lists is every one it knows. */
export function fetchCurrencies(api: RetrospendClient) {
	return () => api.currencies.list({ kind: "fiat", limit: 200 });
}

export function fetchFavoriteRates(api: RetrospendClient) {
	return () => api.settings.listFavoriteRates({ limit: 100 });
}

/** Day 1 to 28, the months a fiscal month can start on. */
export const MONTH_START_DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

/**
 * The preferences with one type's channel switched. Types the server did
 * not list are not invented; the list keeps its order.
 */
export function withChannel(
	preferences: NotificationPreference[],
	type: NotificationType,
	channel: "inApp" | "email" | "push",
	on: boolean,
): NotificationPreference[] {
	return preferences.map((p) =>
		p.type === type ? { ...p, [channel]: on } : p,
	);
}

/** The one preference a switch changed, as the PUT body wants it. */
export function preferenceOf(
	preferences: NotificationPreference[],
	type: NotificationType,
): NotificationPreference | null {
	return preferences.find((p) => p.type === type) ?? null;
}

/** The host of a server address: what the row shows ("retrospend.app"). */
export function hostOf(baseUrl: string): string {
	try {
		return new URL(baseUrl).host;
	} catch {
		return baseUrl;
	}
}
