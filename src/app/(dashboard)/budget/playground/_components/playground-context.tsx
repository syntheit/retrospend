"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSettings } from "~/hooks/use-settings";
import { getCurrentFiscalMonth } from "~/lib/fiscal-month";
import { api } from "~/trpc/react";
import type { Budget, Category } from "~/types/budget-types";

interface PlaygroundState {
	simulatedBudgets: Record<string, number>; // categoryId -> amount
	baseBudgets: Budget[];
	categories: Category[];
	isLoading: boolean;
	selectedMonth: Date;
	monthlyIncome: number;
}

interface PlaygroundContextType extends PlaygroundState {
	updateBudget: (categoryId: string, amount: number) => void;
	resetAll: () => void;
	setSelectedMonth: (date: Date) => void;
	isDirty: boolean;
}

const PlaygroundContext = createContext<PlaygroundContextType | undefined>(
	undefined,
);

const EMPTY_BUDGETS: Budget[] = [];
const EMPTY_CATEGORIES: Category[] = [];

export function PlaygroundProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const { data: settings } = useSettings();
	const fiscalStartDay = settings?.fiscalMonthStartDay ?? 1;

	// Use server time for consistent timezone handling
	const { data: serverTimeData } = api.system.getServerTime.useQuery(
		undefined,
		{ staleTime: 30_000 },
	);

	const [selectedMonth, setSelectedMonth] = useState(() =>
		getCurrentFiscalMonth(new Date(), fiscalStartDay),
	);
	const [simulatedBudgets, setSimulatedBudgets] = useState<
		Record<string, number>
	>({});
	const [isDirty, setIsDirty] = useState(false);

	// Re-sync once server time + settings load
	const hasSynced = useRef(false);
	useEffect(() => {
		if (serverTimeData?.serverTime && settings && !hasSynced.current) {
			hasSynced.current = true;
			setSelectedMonth(
				getCurrentFiscalMonth(
					new Date(serverTimeData.serverTime),
					settings.fiscalMonthStartDay ?? 1,
				),
			);
		}
	}, [serverTimeData?.serverTime, settings]);

	const { data: baseBudgetsData, isLoading: loadingBudgets } =
		api.budget.getBudgets.useQuery({
			month: selectedMonth,
		});
	const baseBudgets = baseBudgetsData ?? EMPTY_BUDGETS;

	const { data: categoriesData, isLoading: loadingCategories } =
		api.categories.getAll.useQuery();
	const categories = categoriesData ?? EMPTY_CATEGORIES;

	const { data: stats } = api.dashboard.getOverviewStats.useQuery({
		month: selectedMonth,
	});

	const monthlyIncome = stats?.workEquivalent.monthlyIncome ?? 0;

	// Initialize simulated budgets from base budgets when they load or month changes
	// Only sync if the user hasn't explicitly edited the current view
	useEffect(() => {
		if (!isDirty && baseBudgets.length > 0) {
			const initial: Record<string, number> = {};
			for (const b of baseBudgets) {
				if (b.category) {
					initial[b.category.id] = b.amount;
				}
			}
			setSimulatedBudgets(initial);
		}
	}, [baseBudgets, isDirty]);

	const updateBudget = (categoryId: string, amount: number) => {
		setSimulatedBudgets((prev: Record<string, number>) => ({
			...prev,
			[categoryId]: amount,
		}));
		setIsDirty(true);
	};

	const resetAll = () => {
		const initial: Record<string, number> = {};
		for (const b of baseBudgets) {
			if (b.category) {
				initial[b.category.id] = b.amount;
			}
		}
		setSimulatedBudgets(initial);
		setIsDirty(false);
		toast.info("Reset to live budget data");
	};

	const handleSetSelectedMonth = (date: Date) => {
		setSelectedMonth(date);
		setIsDirty(false);
	};

	const hasActualChanges = useMemo(() => {
		for (const b of baseBudgets) {
			if (b.category) {
				const simulated = simulatedBudgets[b.category.id];
				if (simulated !== undefined && simulated !== b.amount) return true;
			}
		}

		const baseIds = new Set(
			baseBudgets.map((b) => b.category?.id).filter((id): id is string => !!id),
		);
		for (const catId in simulatedBudgets) {
			if (!baseIds.has(catId) && (simulatedBudgets[catId] ?? 0) > 0)
				return true;
		}

		return false;
	}, [simulatedBudgets, baseBudgets]);

	const value = {
		simulatedBudgets,
		baseBudgets,
		categories,
		isLoading: loadingBudgets || loadingCategories,
		selectedMonth,
		monthlyIncome,
		updateBudget,
		resetAll,
		setSelectedMonth: handleSetSelectedMonth,
		isDirty: isDirty || hasActualChanges,
	};

	return (
		<PlaygroundContext.Provider value={value}>
			{children}
		</PlaygroundContext.Provider>
	);
}

export function usePlayground() {
	const context = useContext(PlaygroundContext);
	if (context === undefined) {
		throw new Error("usePlayground must be used within a PlaygroundProvider");
	}
	return context;
}
