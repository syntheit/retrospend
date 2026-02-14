import { useMemo } from "react";
import {
	convertExpenseAmountForDisplay,
	type NormalizedExpense,
	normalizeExpenses,
	toNumberOrNull,
	toNumberWithDefault,
} from "~/lib/utils";
import { api } from "~/trpc/react";
import { useCurrency } from "./use-currency";
import { useTableFilters } from "./use-table-filters";

export type ExpenseRow = NormalizedExpense;

/**
 * useExpensesController - Business logic for the expenses table.
 * Handles:
 * - Data fetching and normalization (via TRPC select)
 * - Filtering state (delegated to useTableFilters)
 * - Aggregates/Totals calculation
 */
export function useExpensesController() {
	const { data: settings } = api.settings.getGeneral.useQuery();
	const { usdToHomeRate: liveRateToBaseCurrency } = useCurrency();
	const homeCurrency = settings?.homeCurrency || "USD";

	const {
		data: expenses,
		isLoading,
		isError,
		error,
		refetch,
	} = api.expense.listFinalized.useQuery(undefined, {
		// Optimization: Normalize Prisma Decimals to Numbers only when data changes
		select: (data) => {
			return normalizeExpenses(
				data.map((expense) => ({
					...expense,
					amount: toNumberWithDefault(expense.amount),
					exchangeRate: toNumberOrNull(expense.exchangeRate),
					amountInUSD: toNumberOrNull(expense.amountInUSD),
				})),
			);
		},
	});

	const { data: filterOptions } = api.expense.getFilterOptions.useQuery();

	// Connect filtering logic
	const filterState = useTableFilters(expenses ?? [], {
		availableYears: filterOptions?.years,
	});

	// Calculate totals based on filtered items
	const totals = useMemo(() => {
		const filtered = filterState.filteredExpenses;

		// 1. Total in Home Currency
		const totalAmount = filtered.reduce(
			(acc, curr) =>
				acc +
				convertExpenseAmountForDisplay(
					curr,
					homeCurrency,
					liveRateToBaseCurrency ?? null,
				),
			0,
		);

		const foreignExpenses = filtered.filter((e) => e.currency !== "USD");

		return {
			totalAmount,
			count: filtered.length,
			hasForeignCurrencyExpenses: foreignExpenses.length > 0,
		};
	}, [filterState.filteredExpenses, homeCurrency, liveRateToBaseCurrency]);

	return {
		expenses: filterState.filteredExpenses,
		allExpenses: expenses ?? [],
		totals,
		filters: filterState,
		homeCurrency,
		liveRateToBaseCurrency,
		isLoading,
		isError,
		error,
		refetch,
	};
}
