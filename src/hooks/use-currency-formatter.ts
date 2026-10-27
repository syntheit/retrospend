"use client";

import { formatCompactAmount } from "@retrospend/domain/currency-format";
import { withNumberFormat } from "@retrospend/domain/format-locale";
import { useCallback } from "react";
import { BASE_CURRENCY } from "~/lib/constants";
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
	// Null follows the language (each currency's own pattern, as before).
	const numberFormat = settings?.numberFormat ?? null;

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
				numberFormat,
			);
		},
		[symbolStyle, smartFormatting, numberFormat],
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
				withNumberFormat(locale ?? "en-US", numberFormat),
			),
		[symbolStyle, numberFormat],
	);

	return {
		formatCurrency: formatCurrencyWithSettings,
		formatCompactCurrency,
		getCurrencySymbol: getCurrencySymbolWithSettings,
	};
}
