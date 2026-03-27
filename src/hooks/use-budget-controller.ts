"use client";

import { addMonths } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCurrency } from "~/hooks/use-currency";
import { useIsMobile } from "~/hooks/use-mobile";
import { useSettings } from "~/hooks/use-settings";
import { getCurrentFiscalMonth } from "~/lib/fiscal-month";
import { handleError } from "~/lib/handle-error";
import { api } from "~/trpc/react";

export function useBudgetController() {
	const { data: settings } = useSettings();
	const fiscalStartDay = settings?.fiscalMonthStartDay ?? 1;
	const isMobile = useIsMobile();
	const { homeCurrency, usdToHomeRate } = useCurrency();
	const utils = api.useUtils();

	// Use server time for initial month to avoid timezone mismatch
	const { data: serverTimeData } = api.system.getServerTime.useQuery(
		undefined,
		{ staleTime: 30_000 },
	);
	const serverTime = serverTimeData?.serverTime
		? new Date(serverTimeData.serverTime)
		: undefined;

	const [selectedMonth, setSelectedMonth] = useState(() =>
		getCurrentFiscalMonth(new Date(), fiscalStartDay),
	);

	// Re-sync once server time + settings are available
	const hasSynced = useRef(false);
	useEffect(() => {
		if (serverTime && settings && !hasSynced.current) {
			hasSynced.current = true;
			setSelectedMonth(
				getCurrentFiscalMonth(serverTime, settings.fiscalMonthStartDay ?? 1),
			);
		}
	}, [serverTime, settings]);

	// Allow planning 12 months ahead
	const budgetMaxDate = useMemo(() => {
		if (!serverTime) return undefined;
		return addMonths(serverTime, 12);
	}, [serverTime]);

	const { data: budgets, isLoading: loadingBudgets } =
		api.budget.getBudgets.useQuery({ month: selectedMonth });

	const { data: categories, isLoading: loadingCategories } =
		api.categories.getAll.useQuery();

	const { data: hasPreviousBudgets } =
		api.budget.hasBudgetsBeforeMonth.useQuery({ month: selectedMonth });

	const { data: earliestMonth } =
		api.budget.getEarliestBudgetMonth.useQuery();

	const copyFromLastMonth = api.budget.copyFromLastMonth.useMutation();

	const isLoading = loadingBudgets || loadingCategories;

	const categoryBudgets = useMemo(() => {
		if (!budgets) return [];
		return budgets
			.map((budget) => {
				const category = budget.category;
				if (!category) return null;
				return {
					id: category.id,
					name: category.name,
					color: category.color,
					allocatedAmount: Number(
						budget.pegToActual ? budget.effectiveAmount : budget.amount,
					),
					actualSpend: Number(budget.actualSpend),
					pegToActual: budget.pegToActual ?? false,
				};
			})
			.filter((b): b is NonNullable<typeof b> => b !== null);
	}, [budgets]);

	const handleCopyFromLastMonth = async () => {
		try {
			await copyFromLastMonth.mutateAsync({ targetMonth: selectedMonth });
			await Promise.all([
				utils.budget.getBudgets.invalidate({ month: selectedMonth }),
				utils.budget.hasBudgetsBeforeMonth.invalidate({
					month: selectedMonth,
				}),
			]);
		} catch (error) {
			handleError(error, "Failed to copy budgets");
		}
	};

	const hasContent =
		(budgets && budgets.length > 0) || (categories && categories.length > 0);

	return {
		// State
		selectedMonth,
		setSelectedMonth,
		isLoading,
		isMobile,

		// Data
		budgets: budgets ?? [],
		categories: categories ?? [],
		categoryBudgets,
		hasPreviousBudgets: hasPreviousBudgets ?? false,
		hasContent,

		// Currency
		homeCurrency,
		usdToHomeRate: usdToHomeRate ?? 1,

		// Dates
		serverTime,
		budgetMaxDate,
		budgetMinDate: earliestMonth ?? undefined,

		// Actions
		handleCopyFromLastMonth,
		isCopying: copyFromLastMonth.isPending,
	};
}
