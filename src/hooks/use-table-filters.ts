import { useMemo, useState } from "react";

/**
 * Expense type for filtering (matches the normalized expense structure)
 */
type FilterableExpense = {
	id: string;
	date: Date;
	categoryId: string | null;
	category?: { id: string; name: string; color: string; icon?: string | null } | null;
};

/**
 * Category with usage count for display
 */
type CategoryWithUsage = {
	id: string;
	name: string;
	color: string;
	icon?: string | null;
	usageCount: number;
};

export type DateRangeState = {
	from: Date;
	to: Date;
	preset?: string;
} | null;

export type AmountRange = {
	min?: number;
	max?: number;
};

/**
 * Helper to check if an expense matches the time filters
 */
const matchesTimeFilter = (
	expenseDate: Date,
	selectedYears: Set<number>,
	selectedMonths: Set<number>,
): boolean => {
	const yearMatch =
		selectedYears.size === 0 || selectedYears.has(expenseDate.getFullYear());
	const monthMatch =
		selectedMonths.size === 0 || selectedMonths.has(expenseDate.getMonth());
	return yearMatch && monthMatch;
};

/**
 * useTableFilters - Headless hook for managing expense table filters
 *
 * Extracted from table/page.tsx to separate filter state management
 * from UI rendering. Handles year, month, category, date range, and amount range filtering.
 */
export function useTableFilters<T extends FilterableExpense>(
	expenses: T[],
	options?: {
		availableYears?: number[];
		initialYears?: number[];
		initialMonths?: number[];
		initialCategories?: string[];
		initialDateRange?: { from: Date; to: Date; preset?: string };
		initialAmountRange?: AmountRange;
	},
) {
	const {
		availableYears: providedYears,
		initialYears,
		initialMonths,
		initialCategories,
		initialDateRange,
		initialAmountRange,
	} = options ?? {};

	// Get current year/month for default filter
	const getCurrentYearMonth = () => {
		const date = new Date();
		return { year: date.getFullYear(), month: date.getMonth() };
	};

	const { year: currentYear, month: currentMonth } = getCurrentYearMonth();

	// Filter state — initialize from provided values or defaults
	const [selectedYears, setSelectedYears] = useState<Set<number>>(
		() =>
			initialYears?.length
				? new Set(initialYears)
				: new Set([currentYear]),
	);
	const [selectedMonths, setSelectedMonths] = useState<Set<number>>(
		() =>
			initialMonths?.length
				? new Set(initialMonths)
				: new Set([currentMonth]),
	);
	const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
		() =>
			initialCategories?.length
				? new Set(initialCategories)
				: new Set(),
	);

	// Date range filter (mutually exclusive with year/month)
	const [dateRange, setDateRange] = useState<DateRangeState>(() => {
		if (
			initialDateRange &&
			!isNaN(initialDateRange.from.getTime()) &&
			!isNaN(initialDateRange.to.getTime())
		) {
			return initialDateRange;
		}
		return null;
	});

	// Amount range filter (state only — actual filtering done in controller
	// because it needs currency conversion)
	const [amountRange, setAmountRange] = useState<AmountRange>(
		() => initialAmountRange ?? {},
	);

	// Compute available years from expenses
	const availableYears = useMemo(() => {
		if (providedYears) return providedYears;
		const years = new Set<number>();
		expenses.forEach((expense) => {
			years.add(expense.date.getFullYear());
		});
		return Array.from(years).sort((a, b) => b - a);
	}, [expenses, providedYears]);

	// Compute available months from expenses
	const availableMonths = useMemo(() => {
		const months = new Set<number>();
		expenses.forEach((expense) => {
			months.add(expense.date.getMonth());
		});
		return Array.from(months).sort((a, b) => a - b);
	}, [expenses]);

	// Compute available categories (only from time-filtered expenses)
	const availableCategories = useMemo(() => {
		const categoryMap = new Map<string, CategoryWithUsage>();

		const timeFilteredExpenses = expenses.filter((expense) => {
			if (dateRange) {
				return expense.date >= dateRange.from && expense.date <= dateRange.to;
			}
			return matchesTimeFilter(expense.date, selectedYears, selectedMonths);
		});

		timeFilteredExpenses.forEach((expense) => {
			if (expense.category) {
				const existing = categoryMap.get(expense.category.id);
				if (existing) {
					existing.usageCount++;
				} else {
					categoryMap.set(expense.category.id, {
						...expense.category,
						usageCount: 1,
					});
				}
			}
		});

		return Array.from(categoryMap.values()).sort(
			(a, b) => b.usageCount - a.usageCount,
		);
	}, [expenses, selectedYears, selectedMonths, dateRange]);

	// Compute filtered expenses based on all active filters
	const filteredExpenses = useMemo(() => {
		return expenses.filter((expense) => {
			// Time filtering: date range takes precedence over year/month
			let timeMatch: boolean;
			if (dateRange) {
				timeMatch =
					expense.date >= dateRange.from && expense.date <= dateRange.to;
			} else {
				timeMatch = matchesTimeFilter(
					expense.date,
					selectedYears,
					selectedMonths,
				);
			}

			const categoryMatch =
				selectedCategories.size === 0 ||
				(expense.categoryId && selectedCategories.has(expense.categoryId));

			return timeMatch && categoryMatch;
		});
	}, [expenses, selectedYears, selectedMonths, selectedCategories, dateRange]);

	// Toggle handlers — clear dateRange when switching to year/month
	const toggleYear = (year: number) => {
		if (dateRange) setDateRange(null);
		setSelectedYears((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(year)) {
				newSet.delete(year);
			} else {
				newSet.add(year);
			}
			return newSet;
		});
	};

	const toggleMonth = (month: number) => {
		if (dateRange) setDateRange(null);
		setSelectedMonths((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(month)) {
				newSet.delete(month);
			} else {
				newSet.add(month);
			}
			return newSet;
		});
	};

	const toggleCategory = (categoryId: string) => {
		setSelectedCategories((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(categoryId)) {
				newSet.delete(categoryId);
			} else {
				newSet.add(categoryId);
			}
			return newSet;
		});
	};

	// Clear all filters
	const clearFilters = () => {
		setSelectedYears(new Set());
		setSelectedMonths(new Set());
		setSelectedCategories(new Set());
		setDateRange(null);
		setAmountRange({});
	};

	// Individual clear handlers
	const clearYears = () => setSelectedYears(new Set());
	const clearMonths = () => setSelectedMonths(new Set());
	const clearCategories = () => setSelectedCategories(new Set());
	const clearDateRange = () => setDateRange(null);
	const clearAmountRange = () => setAmountRange({});

	return {
		// Filter state
		selectedYears,
		selectedMonths,
		selectedCategories,
		dateRange,
		amountRange,

		// Available options
		availableYears,
		availableMonths,
		availableCategories,

		// Filtered data
		filteredExpenses,

		// Toggle handlers
		toggleYear,
		toggleMonth,
		toggleCategory,

		// Setters
		setDateRange,
		setAmountRange,

		// Clear handlers
		clearFilters,
		clearYears,
		clearMonths,
		clearCategories,
		clearDateRange,
		clearAmountRange,
	};
}
