import { useMemo } from "react";
import { useSession } from "@/auth/session";
import { useCachedRead } from "@/features/read/useCachedRead";
import { CATEGORIES_CACHE, fetchCategories } from "./categories/source";
import { fetchPaymentMethods, PAYMENT_CACHE } from "./payment/source";
import {
	CURRENCIES_CACHE,
	fetchCurrencies,
	NOTIFICATIONS_CACHE,
	PROFILE_CACHE,
	SETTINGS_CACHE,
} from "./source";

// Each read is cached like every other screen's, so Settings opens offline
// with what the phone last saw.

export function useProfile() {
	const { api } = useSession();
	const fetch = useMemo(() => (api ? () => api.profile.get() : null), [api]);
	return useCachedRead(PROFILE_CACHE, fetch);
}

export function useGeneralSettings() {
	const { api } = useSession();
	const fetch = useMemo(() => (api ? () => api.settings.get() : null), [api]);
	return useCachedRead(SETTINGS_CACHE, fetch);
}

export function useNotificationPreferences() {
	const { api } = useSession();
	const fetch = useMemo(
		() => (api ? () => api.notifications.getPreferences() : null),
		[api],
	);
	return useCachedRead(NOTIFICATIONS_CACHE, fetch);
}

export function useFiatCurrencies() {
	const { api } = useSession();
	const fetch = useMemo(() => (api ? fetchCurrencies(api) : null), [api]);
	return useCachedRead(CURRENCIES_CACHE, fetch);
}

export function useCategories() {
	const { api } = useSession();
	const fetch = useMemo(() => (api ? fetchCategories(api) : null), [api]);
	return useCachedRead(CATEGORIES_CACHE, fetch);
}

export function usePaymentMethods() {
	const { api } = useSession();
	const fetch = useMemo(() => (api ? fetchPaymentMethods(api) : null), [api]);
	return useCachedRead(PAYMENT_CACHE, fetch);
}
