"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Calculator, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "~/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { api } from "~/trpc/react";

interface BudgetHeaderProps {
	selectedMonth: Date;
	budgetMode: "GLOBAL_LIMIT" | "SUM_OF_CATEGORIES";
	homeCurrency: string;
	budgets: Array<{
		amount: number;
		effectiveAmount: number;
		pegToActual: boolean;
	}>;
}

export function BudgetHeader({
	selectedMonth,
	budgetMode,
	homeCurrency,
	budgets,
}: BudgetHeaderProps) {
	const { formatCurrency } = useCurrencyFormatter();
	const queryClient = useQueryClient();
	const [globalLimit, setGlobalLimit] = useState<string>("");
	const [isUpdating, setIsUpdating] = useState(false);
	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

	// Get current global budget
	const { data: globalBudget } = api.budget.getGlobalBudget.useQuery({
		month: selectedMonth,
	});

	// Update global budget mutation
	const upsertGlobalBudget = api.budget.upsertGlobalBudget.useMutation({
		onSuccess: () => {
			setIsUpdating(false);
			setHasUnsavedChanges(false);
			// Invalidate the query to ensure fresh data
			queryClient.invalidateQueries({
				queryKey: [["budget", "getGlobalBudget"]],
			});
		},
		onError: (error) => {
			console.error("Failed to update global budget:", error);
			setIsUpdating(false);
		},
	});

	// Delete global budget mutation
	const deleteGlobalBudget = api.budget.deleteGlobalBudget.useMutation({
		onSuccess: () => {
			setIsUpdating(false);
			setHasUnsavedChanges(false);
			// Invalidate the query to ensure fresh data
			queryClient.invalidateQueries({
				queryKey: [["budget", "getGlobalBudget"]],
			});
		},
		onError: (error) => {
			console.error("Failed to delete global budget:", error);
			setIsUpdating(false);
		},
	});

	// Update settings mutation for mode toggle
	const updateSettings = api.user.updateSettings.useMutation({
		onSuccess: () => {
			// Invalidate the settings query to ensure fresh data
			queryClient.invalidateQueries({
				queryKey: [["user", "getSettings"]],
			});
		},
		onError: (error) => {
			console.error("Failed to update budget mode:", error);
		},
	});

	// Sync local state with fetched data only when not actively editing
	useEffect(() => {
		if (!hasUnsavedChanges && !isUpdating) {
			if (globalBudget) {
				setGlobalLimit(globalBudget.amount.toString());
			} else {
				setGlobalLimit("");
			}
		}
	}, [globalBudget, hasUnsavedChanges, isUpdating]);

	const handleLimitChange = (value: string) => {
		setGlobalLimit(value);
		setHasUnsavedChanges(true);

		// Debounce the update
		setIsUpdating(true);
		const timeoutId = setTimeout(() => {
			const amount = parseFloat(value);
			if (!Number.isNaN(amount) && amount > 0) {
				upsertGlobalBudget.mutate({
					amount,
					period: selectedMonth,
				});
			} else if (value === "") {
				// If empty, delete the global budget
				deleteGlobalBudget.mutate({
					period: selectedMonth,
				});
			}
		}, 500);

		return () => clearTimeout(timeoutId);
	};

	const handleLimitBlur = () => {
		// Ensure final update on blur (only if not already updating)
		if (!isUpdating) {
			const amount = parseFloat(globalLimit);
			if (!Number.isNaN(amount) && amount > 0) {
				setIsUpdating(true);
				upsertGlobalBudget.mutate({
					amount,
					period: selectedMonth,
				});
			} else if (globalLimit === "") {
				setIsUpdating(true);
				deleteGlobalBudget.mutate({
					period: selectedMonth,
				});
			}
		}
	};

	const handleModeChange = (value: string | undefined) => {
		if (!value) return;
		const newMode = value as "GLOBAL_LIMIT" | "SUM_OF_CATEGORIES";
		updateSettings.mutate({
			homeCurrency,
			budgetMode: newMode,
		});
	};

	const isSumMode = budgetMode === "SUM_OF_CATEGORIES";

	// Calculate total budget from categories
	const totalCategoryBudget =
		budgets?.reduce(
			(sum, budget) =>
				sum +
				Number(budget.pegToActual ? budget.effectiveAmount : budget.amount),
			0,
		) || 0;

	const displayAmount = isSumMode
		? totalCategoryBudget
		: (globalBudget?.amount ?? 0);

	return (
		<div className="space-y-8">
			{/* Header with Month and Mode Toggle */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<h1 className="text-2xl font-semibold">
						{selectedMonth.toLocaleDateString("en-US", {
							month: "long",
							year: "numeric",
						})}
					</h1>
				</div>

				<ToggleGroup
					type="single"
					value={budgetMode}
					onValueChange={handleModeChange}
					className="bg-muted"
				>
					<ToggleGroupItem
						value="SUM_OF_CATEGORIES"
						className="flex items-center gap-2"
					>
						<Calculator className="h-4 w-4" />
						Manual
					</ToggleGroupItem>
					<ToggleGroupItem
						value="GLOBAL_LIMIT"
						className="flex items-center gap-2"
					>
						<Lock className="h-4 w-4" />
						Global Limit
					</ToggleGroupItem>
				</ToggleGroup>
			</div>

			{/* Hero Budget Display */}
			<div className="flex flex-col items-center space-y-2">
				<h2 className="text-sm font-medium text-muted-foreground">
					Total Monthly Budget
				</h2>
				{isSumMode ? (
					<div className="text-4xl font-bold text-muted-foreground">
						{formatCurrency(displayAmount, homeCurrency)}
					</div>
				) : (
					<div className="relative">
						<span className="absolute top-1/2 left-4 -translate-y-1/2 text-2xl text-muted-foreground">
							{homeCurrency === "USD" ? "$" : homeCurrency}
						</span>
						<Input
							className="h-auto border-0 bg-transparent p-0 text-center text-4xl font-bold shadow-none focus-visible:ring-0"
							min="0"
							onBlur={handleLimitBlur}
							onChange={(e) => handleLimitChange(e.target.value)}
							placeholder="0.00"
							step="0.01"
							type="number"
							value={globalLimit}
						/>
						{isUpdating && (
							<div className="absolute top-1/2 right-4 -translate-y-1/2">
								<div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
