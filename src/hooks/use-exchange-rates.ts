"use client";

import { useCallback, useMemo } from "react";
import { getRateTypeLabel } from "~/lib/exchange-rates-shared";
import { api } from "~/trpc/react";

export interface RateOption {
	type: string;
	rate: number;
	label: string;
}

interface UseExchangeRatesOptions {
	currency: string;
	enabled?: boolean;
	/** Include a "Custom" option in rateOptions */
	includeCustomOption?: boolean;
	/** If true, prefers favorites > blue > official for default. If false, prefers official > blue > first */
	preferFavorites?: boolean;
}

interface UseExchangeRatesResult {
	rateOptions: RateOption[];
	rawRateOptions: RateOption[];
	isLoading: boolean;
	getDefaultRate: () => RateOption | null;
	getRateByType: (type: string) => RateOption | null;
	getEffectiveRate: (rate: number, invertMode?: boolean) => number;
}

export function useExchangeRates({
	currency,
	enabled = true,
	includeCustomOption = false,
	preferFavorites = false,
}: UseExchangeRatesOptions): UseExchangeRatesResult {
	const { data: rates, isLoading } =
		api.exchangeRate.getRatesForCurrency.useQuery(
			{ currency },
			{ enabled: enabled && !!currency },
		);

	// Only fetch favorites if we need them for default rate selection
	const { data: favorites } = api.preferences.getFavoriteExchangeRates.useQuery(
		undefined,
		{ enabled: enabled && preferFavorites },
	);

	// Raw rate options without custom
	const rawRateOptions = useMemo<RateOption[]>(() => {
		if (!rates) return [];
		return rates.map((rate) => ({
			type: rate.type,
			rate: Number(rate.rate),
			label: getRateTypeLabel(rate.type),
		}));
	}, [rates]);

	// Rate options with optional custom option
	const rateOptions = useMemo<RateOption[]>(() => {
		const options = [...rawRateOptions];
		if (includeCustomOption) {
			options.push({
				type: "custom",
				rate: 0,
				label: "Custom",
			});
		}
		return options;
	}, [rawRateOptions, includeCustomOption]);

	const getEffectiveRate = useCallback(
		(rate: number, invertMode = false): number => {
			if (invertMode && rate > 0) return 1 / rate;
			return rate;
		},
		[],
	);

	const getDefaultRate = useMemo(() => {
		return (): RateOption | null => {
			if (rawRateOptions.length === 0) return null;

			if (preferFavorites && favorites && favorites.length > 0) {
				for (const fav of favorites) {
					if (fav.rate.currency === currency) {
						const matchingRate = rawRateOptions.find(
							(r) => r.type === fav.rate.type,
						);
						if (matchingRate) {
							return matchingRate;
						}
					}
				}
			}

			// Prefer "blue" rate (for Argentina ARS), then "official", then first available
			const blueRate = rawRateOptions.find((r) => r.type === "blue");
			if (blueRate) return blueRate;

			const officialRate = rawRateOptions.find((r) => r.type === "official");
			if (officialRate) return officialRate;

			return rawRateOptions[0] || null;
		};
	}, [rawRateOptions, preferFavorites, favorites, currency]);

	const getRateByType = useMemo(() => {
		return (type: string): RateOption | null => {
			return rawRateOptions.find((r) => r.type === type) || null;
		};
	}, [rawRateOptions]);

	return {
		rateOptions,
		rawRateOptions,
		isLoading,
		getDefaultRate,
		getRateByType,
		getEffectiveRate,
	};
}
