import { useMemo, useState } from "react";

/**
 * Expense type for filtering (matches the normalized expense structure)
 */
type FilterableExpense = {
	id: string;
	date: Date;
	categoryId: string | null;
	category?: { id: string; name: string; color: string } | null;
};

/**
 * Category with usage count for display
 */
type CategoryWithUsage = {
	id: string;
	name: string;
	color: string;
	usageCount: number;
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
 * from UI rendering. Handles year, month, and category filtering.
 */
export function useTableFilters<T extends FilterableExpense>(
	expenses: T[],
	options?: {
		availableYears?: number[];
	},
) {
	const { availableYears: providedYears } = options ?? {};
	// Get current year/month for default filter
	const getCurrentYearMonth = () => {
		const date = new Date();
		return { year: date.getFullYear(), month: date.getMonth() };
	};

	const { year: currentYear, month: currentMonth } = getCurrentYearMonth();

	// Filter state
	const [selectedYears, setSelectedYears] = useState<Set<number>>(
		() => new Set([currentYear]),
	);
	const [selectedMonths, setSelectedMonths] = useState<Set<number>>(
		() => new Set([currentMonth]),
	);
	const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
		() => new Set(),
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

		const timeFilteredExpenses = expenses.filter((expense) =>
			matchesTimeFilter(expense.date, selectedYears, selectedMonths),
		);

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
	}, [expenses, selectedYears, selectedMonths]);

	// Compute filtered expenses based on all active filters
	const filteredExpenses = useMemo(() => {
		if (
			selectedYears.size === 0 &&
			selectedMonths.size === 0 &&
			selectedCategories.size === 0
		) {
			return expenses;
		}

		return expenses.filter((expense) => {
			const timeMatch = matchesTimeFilter(
				expense.date,
				selectedYears,
				selectedMonths,
			);
			const categoryMatch =
				selectedCategories.size === 0 ||
				(expense.categoryId && selectedCategories.has(expense.categoryId));
			return timeMatch && categoryMatch;
		});
	}, [expenses, selectedYears, selectedMonths, selectedCategories]);

	// Toggle handlers
	const toggleYear = (year: number) => {
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
	};

	// Individual clear handlers
	const clearYears = () => setSelectedYears(new Set());
	const clearMonths = () => setSelectedMonths(new Set());
	const clearCategories = () => setSelectedCategories(new Set());

	return {
		// Filter state
		selectedYears,
		selectedMonths,
		selectedCategories,

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

		// Clear handlers
		clearFilters,
		clearYears,
		clearMonths,
		clearCategories,
	};
}
