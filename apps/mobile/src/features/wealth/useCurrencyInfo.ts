import { useMemo } from "react";
import { useSession } from "@/auth/session";
import { useCachedRead } from "@/features/read/useCachedRead";
import {
	CURRENCY_INFO_CACHE,
	type CurrencyInfo,
	fetchCurrencyInfo,
} from "./source";

/** The currencies an account can be in, cache first; empty until the first read. */
export function useCurrencyInfo(): CurrencyInfo[] {
	const { api } = useSession();
	const fetch = useMemo(() => (api ? fetchCurrencyInfo(api) : null), [api]);
	const { state } = useCachedRead(CURRENCY_INFO_CACHE, fetch);
	return state.status === "ready" ? state.data : [];
}
