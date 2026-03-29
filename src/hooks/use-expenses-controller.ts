import { useMemo, useState } from "react";
import { useSettings } from "~/hooks/use-settings";
import {
	convertExpenseAmountForDisplay,
	type NormalizedExpense,
	normalizeExpenses,
	toNumberOrNull,
	toNumberWithDefault,
} from "~/lib/utils";
import { api } from "~/trpc/react";
import { useCurrency } from "./use-currency";
import { useTableFilters, type AmountRange } from "./use-table-filters";

export type ExpenseRow = NormalizedExpense;

/**
 * useExpensesController - Business logic for the expenses table.
 * Handles:
 * - Data fetching and normalization (via TRPC select)
 * - Filtering state (delegated to useTableFilters)
 * - Aggregates/Totals calculation
 * - Merging shared expense participations
 */
export function useExpensesController(options?: {
	initialYears?: number[];
	initialMonths?: number[];
	initialCategories?: string[];
	initialDateRange?: { from: Date; to: Date; preset?: string };
	initialAmountRange?: AmountRange;
}) {
	const { data: settings } = useSettings();
	const { usdToHomeRate: liveRateToBaseCurrency } = useCurrency();
	const homeCurrency = settings?.homeCurrency || "USD";
	const [typeFilter, setTypeFilter] = useState<"all" | "personal" | "shared">("all");
	const [excludeFilter, setExcludeFilter] = useState<"all" | "included" | "excluded">("all");

	const {
		data: personalExpenses,
		isLoading: isLoadingPersonal,
		isError,
		error,
		refetch,
	} = api.expense.listFinalized.useQuery(undefined, {
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

	const { data: sharedParticipations, isLoading: isLoadingShared } =
		api.expense.listSharedParticipations.useQuery();

	const expenses = useMemo(() => {
		let personal: NormalizedExpense[] = (personalExpenses ?? []).map((e) => ({
			...e,
			source: "personal" as const,
		}));

		if (excludeFilter === "included") {
			personal = personal.filter((e) => !e.excludeFromAnalytics);
		} else if (excludeFilter === "excluded") {
			personal = personal.filter((e) => e.excludeFromAnalytics);
		}

		const shared: NormalizedExpense[] = (sharedParticipations ?? []).map((sp) => ({
			id: sp.id,
			title: sp.description,
			amount: sp.amount,
			currency: sp.currency,
			exchangeRate: sp.exchangeRate,
			amountInUSD: sp.amountInUSD,
			date: new Date(sp.date),
			location: null,
			description: null,
			categoryId: sp.categoryId,
			category: sp.category,
			source: "shared" as const,
			sharedContext: sp.sharedContext,
		}));

		if (typeFilter === "personal") return personal;
		if (typeFilter === "shared") return shared;
		return [...personal, ...shared];
	}, [personalExpenses, sharedParticipations, typeFilter, excludeFilter]);

	const isLoading = isLoadingPersonal || isLoadingShared;

	const { data: filterOptions } = api.expense.getFilterOptions.useQuery();

	// Derive available years from both personal and shared data
	const allYears = useMemo(() => {
		const years = new Set(filterOptions?.years ?? []);
		if (sharedParticipations) {
			for (const sp of sharedParticipations) {
				years.add(new Date(sp.date).getFullYear());
			}
		}
		return [...years].sort((a, b) => b - a);
	}, [filterOptions?.years, sharedParticipations]);

	// Connect filtering logic
	const filterState = useTableFilters(expenses ?? [], {
		availableYears: allYears,
		...(options?.initialYears ? { initialYears: options.initialYears } : {}),
		...(options?.initialMonths ? { initialMonths: options.initialMonths } : {}),
		...(options?.initialCategories ? { initialCategories: options.initialCategories } : {}),
		...(options?.initialDateRange ? { initialDateRange: options.initialDateRange } : {}),
		...(options?.initialAmountRange ? { initialAmountRange: options.initialAmountRange } : {}),
	});

	// Pre-compute converted amounts once for all filtered expenses
	const convertedAmounts = useMemo(() => {
		const map = new Map<string, number>();
		for (const expense of filterState.filteredExpenses) {
			map.set(
				expense.id,
				convertExpenseAmountForDisplay(expense, homeCurrency, liveRateToBaseCurrency ?? null),
			);
		}
		return map;
	}, [filterState.filteredExpenses, homeCurrency, liveRateToBaseCurrency]);

	// Apply amount range filter using pre-computed amounts
	const amountFilteredExpenses = useMemo(() => {
		const { min, max } = filterState.amountRange;
		if (min == null && max == null) return filterState.filteredExpenses;
		return filterState.filteredExpenses.filter((expense) => {
			const amount = convertedAmounts.get(expense.id) ?? 0;
			if (min != null && amount < min) return false;
			if (max != null && amount > max) return false;
			return true;
		});
	}, [filterState.filteredExpenses, filterState.amountRange, convertedAmounts]);

	// Calculate totals from pre-computed amounts (no re-conversion)
	const totals = useMemo(() => {
		const filtered = amountFilteredExpenses;
		let totalAmount = 0;
		let hasForeignCurrencyExpenses = false;

		for (const expense of filtered) {
			totalAmount += convertedAmounts.get(expense.id) ?? 0;
			if (expense.currency !== "USD") hasForeignCurrencyExpenses = true;
		}

		return {
			totalAmount,
			count: filtered.length,
			hasForeignCurrencyExpenses,
		};
	}, [amountFilteredExpenses, convertedAmounts]);

	const hasSharedExpenses = (sharedParticipations ?? []).length > 0;

	return {
		expenses: amountFilteredExpenses,
		allExpenses: expenses ?? [],
		totals,
		filters: filterState,
		homeCurrency,
		liveRateToBaseCurrency,
		isLoading,
		isError,
		error,
		refetch,
		typeFilter,
		setTypeFilter,
		excludeFilter,
		setExcludeFilter,
		hasSharedExpenses,
	};
}
