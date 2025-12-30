"use client";

import { formatCurrency, getCurrencySymbolWithPreference } from "~/lib/utils";
import { useUserSettings } from "./use-user-settings";

export function useCurrencyFormatter() {
	const { settings } = useUserSettings();

	const formatCurrencyWithSettings = (
		amount: number,
		currency = "USD",
	): string => {
		return formatCurrency(
			amount,
			currency,
			settings?.currencySymbolStyle ?? "standard",
		);
	};

	const getCurrencySymbolWithSettings = (currency = "USD"): string => {
		return getCurrencySymbolWithPreference(
			currency,
			settings?.currencySymbolStyle ?? "standard",
		);
	};

	return {
		formatCurrency: formatCurrencyWithSettings,
		getCurrencySymbol: getCurrencySymbolWithSettings,
	};
}
