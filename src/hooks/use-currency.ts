"use client";

import { useMemo } from "react";
import { BASE_CURRENCY } from "~/lib/constants";
import { pickBestRate } from "@retrospend/domain/money";
import { api } from "~/trpc/react";
import { useUserSettings } from "./use-user-settings";

export interface UseCurrencyReturn {
	homeCurrency: string;
	/** Stored rate of the home currency (see ~/lib/money); null while unknown. */
	usdToHomeRate: number | null;
	isLoading: boolean;
}

export function useCurrency(): UseCurrencyReturn {
	const { settings, isLoading: settingsLoading } = useUserSettings();
	const homeCurrency = settings?.homeCurrency ?? BASE_CURRENCY;

	const { data: rates, isLoading: ratesLoading } =
		api.exchangeRate.getRatesForCurrency.useQuery(
			{ currency: homeCurrency },
			{ enabled: homeCurrency !== BASE_CURRENCY },
		);

	// Same selection as the server: latest rate, blue > official > crypto
	const usdToHomeRate = useMemo(() => {
		if (homeCurrency === BASE_CURRENCY) return 1;
		const rows = (rates ?? []).map((r) => ({
			type: r.type,
			rate: Number(r.rate),
			date: new Date(r.date),
		}));
		return pickBestRate(rows)?.rate ?? null;
	}, [rates, homeCurrency]);

	return {
		homeCurrency,
		usdToHomeRate,
		isLoading: settingsLoading || (homeCurrency !== "USD" && ratesLoading),
	};
}
