"use client";

import { useMemo } from "react";
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
}

interface UseExchangeRatesResult {
	/** Array of available rate options for the currency */
	rateOptions: RateOption[];
	/** Whether rates are currently loading */
	isLoading: boolean;
	/** Find the default rate (prefers "blue", then "official", then first available) */
	getDefaultRate: () => RateOption | null;
	/** Find a specific rate by type */
	getRateByType: (type: string) => RateOption | null;
}

/**
 * Hook for fetching and managing exchange rate options for a currency.
 * Provides rate options with human-readable labels and helper functions.
 *
 * @example
 * ```tsx
 * const { rateOptions, isLoading, getDefaultRate } = useExchangeRates({
 *   currency: "ARS",
 * });
 *
 * // Get the default rate on mount
 * useEffect(() => {
 *   const defaultRate = getDefaultRate();
 *   if (defaultRate) {
 *     setSelectedRate(defaultRate.rate);
 *   }
 * }, [rateOptions]);
 * ```
 */
export function useExchangeRates({
	currency,
	enabled = true,
}: UseExchangeRatesOptions): UseExchangeRatesResult {
	const { data: rates, isLoading } =
		api.exchangeRate.getRatesForCurrency.useQuery(
			{ currency },
			{ enabled: enabled && !!currency },
		);

	const rateOptions = useMemo<RateOption[]>(() => {
		if (!rates) return [];
		return rates.map((rate) => ({
			type: rate.type,
			rate: Number(rate.rate),
			label: getRateTypeLabel(rate.type),
		}));
	}, [rates]);

	const getDefaultRate = useMemo(() => {
		return (): RateOption | null => {
			if (rateOptions.length === 0) return null;

			// Prefer "blue" rate, then "official", then first available
			const blueRate = rateOptions.find((r) => r.type === "blue");
			if (blueRate) return blueRate;

			const officialRate = rateOptions.find((r) => r.type === "official");
			if (officialRate) return officialRate;

			return rateOptions[0] || null;
		};
	}, [rateOptions]);

	const getRateByType = useMemo(() => {
		return (type: string): RateOption | null => {
			return rateOptions.find((r) => r.type === type) || null;
		};
	}, [rateOptions]);

	return {
		rateOptions,
		isLoading,
		getDefaultRate,
		getRateByType,
	};
}
