"use client";

import { useCallback } from "react";
import { BASE_CURRENCY } from "~/lib/constants";
import { formatCompactAmount } from "@retrospend/domain/currency-format";
import {
	type CurrencySignDisplay,
	formatCurrency,
	getCurrencySymbolWithPreference,
} from "~/lib/utils";
import { useUserSettings } from "./use-user-settings";

export function useCurrencyFormatter() {
	const { settings } = useUserSettings();

	const symbolStyle = settings?.currencySymbolStyle ?? "standard";
	const smartFormatting = settings?.smartCurrencyFormatting ?? true;

	const formatCurrencyWithSettings = useCallback(
		(
			amount: number,
			currency = BASE_CURRENCY,
			signDisplay: CurrencySignDisplay = "auto",
		): string => {
			return formatCurrency(
				amount,
				currency,
				symbolStyle,
				smartFormatting,
				signDisplay,
			);
		},
		[symbolStyle, smartFormatting],
	);

	const getCurrencySymbolWithSettings = useCallback(
		(currency = BASE_CURRENCY): string => {
			return getCurrencySymbolWithPreference(currency, symbolStyle);
		},
		[symbolStyle],
	);

	/** Compact axis label in `currency`, e.g. "AR$1.2M". */
	const formatCompactCurrency = useCallback(
		(amount: number, currency = BASE_CURRENCY, locale?: string): string =>
			formatCompactAmount(
				amount,
				getCurrencySymbolWithPreference(currency, symbolStyle),
				locale,
			),
		[symbolStyle],
	);

	return {
		formatCurrency: formatCurrencyWithSettings,
		formatCompactCurrency,
		getCurrencySymbol: getCurrencySymbolWithSettings,
	};
}
