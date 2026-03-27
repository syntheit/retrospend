"use client";

import { useCallback } from "react";
import { BASE_CURRENCY } from "~/lib/constants";
import { formatCurrency, getCurrencySymbolWithPreference } from "~/lib/utils";
import { useUserSettings } from "./use-user-settings";

export function useCurrencyFormatter() {
	const { settings } = useUserSettings();

	const symbolStyle = settings?.currencySymbolStyle ?? "standard";
	const smartFormatting = settings?.smartCurrencyFormatting ?? true;

	const formatCurrencyWithSettings = useCallback(
		(amount: number, currency = BASE_CURRENCY): string => {
			return formatCurrency(amount, currency, symbolStyle, smartFormatting);
		},
		[symbolStyle, smartFormatting],
	);

	const getCurrencySymbolWithSettings = useCallback(
		(currency = BASE_CURRENCY): string => {
			return getCurrencySymbolWithPreference(currency, symbolStyle);
		},
		[symbolStyle],
	);

	return {
		formatCurrency: formatCurrencyWithSettings,
		getCurrencySymbol: getCurrencySymbolWithSettings,
	};
}
