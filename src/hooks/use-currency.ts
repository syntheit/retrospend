"use client";

import { useMemo } from "react";
import { BASE_CURRENCY } from "~/lib/constants";
import type { NormalizedExpense } from "~/lib/utils";
import { api } from "~/trpc/react";
import { useUserSettings } from "./use-user-settings";

export interface UseCurrencyReturn {
	homeCurrency: string;
	usdToHomeRate: number | null;
	isLoading: boolean;
	sumExpenses: (expenses: NormalizedExpense[]) => number;
}

/**
 * Pure function to sum expenses with same-currency awareness.
 * Same-currency = original amount. Cross-currency = convert via USD.
 */
export function sumExpensesInCurrency(
	expenses: NormalizedExpense[],
	targetCurrency: string,
	usdToTargetRate: number | null,
): number {
	let total = 0;
	for (const exp of expenses) {
		if (exp.currency === targetCurrency) {
			total += exp.amount; // Same currency: use original
		} else {
			// Different currency: convert via USD using the target rate
			total += (exp.amountInUSD ?? 0) * (usdToTargetRate ?? 1);
		}
	}
	return total;
}

export function useCurrency(): UseCurrencyReturn {
	const { settings, isLoading: settingsLoading } = useUserSettings();
	const homeCurrency = settings?.homeCurrency ?? BASE_CURRENCY;

	const { data: rates, isLoading: ratesLoading } =
		api.exchangeRate.getRatesForCurrency.useQuery(
			{ currency: homeCurrency },
			{ enabled: homeCurrency !== BASE_CURRENCY },
		);

	const usdToHomeRate = useMemo(() => {
		if (homeCurrency === BASE_CURRENCY) return 1;
		if (!rates || rates.length === 0) return null;

		// Priority: blue > official > first available
		const blueRate = rates.find((r) => r.type === "blue");
		if (blueRate) return Number(blueRate.rate);

		const officialRate = rates.find((r) => r.type === "official");
		if (officialRate) return Number(officialRate.rate);

		return Number(rates[0]?.rate) ?? null;
	}, [rates, homeCurrency]);

	const sumExpenses = useMemo(() => {
		return (expenses: NormalizedExpense[]) =>
			sumExpensesInCurrency(expenses, homeCurrency, usdToHomeRate);
	}, [homeCurrency, usdToHomeRate]);

	return {
		homeCurrency,
		usdToHomeRate,
		isLoading: settingsLoading || (homeCurrency !== "USD" && ratesLoading),
		sumExpenses,
	};
}
