"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { CATEGORY_COLOR_MAP } from "~/lib/constants";
import { api } from "~/trpc/react";
import { BulletChart } from "./bullet-chart";
import { QuickChips } from "./quick-chips";

interface BudgetRowProps {
	budget: {
		id: string;
		amount: number;
		actualSpend: number;
		effectiveAmount: number;
		pegToActual: boolean;
		category: {
			id: string;
			name: string;
			color: string;
		} | null;
	};
	selectedMonth: Date;
	isMobile: boolean;
	homeCurrency: string;
	startExpanded?: boolean;
}

export function BudgetRow({
	budget,
	selectedMonth,
	isMobile,
	homeCurrency,
	startExpanded = false,
}: BudgetRowProps) {
	const { formatCurrency } = useCurrencyFormatter();
	const [isExpanded, setIsExpanded] = useState(startExpanded);
	const [amount, setAmount] = useState(budget.amount.toString());
	const [isPegged, setIsPegged] = useState(budget.pegToActual);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [previousPegStatus, setPreviousPegStatus] = useState(
		budget.pegToActual,
	);
	const queryClient = useQueryClient();
	const inputRef = useRef<HTMLInputElement>(null);

	// Get suggestions for quick chips - moved before early return to avoid conditional hook calls
	const { data: suggestions } = api.budget.getBudgetSuggestions.useQuery(
		{ categoryId: budget.category?.id ?? "" },
		{ enabled: isExpanded && !!budget.category },
	);

	const upsertBudget = api.budget.upsertBudget.useMutation({
		onSuccess: (data) => {
			// Show toast only when peg status changes
			if (data.pegToActual !== previousPegStatus) {
				toast.success(
					`Budget moved to ${data.pegToActual ? "Fixed" : "Variable"} section`,
				);
			}
			// Update the previous peg status and local state
			setPreviousPegStatus(data.pegToActual);
			setIsPegged(data.pegToActual);
			// Invalidate the budgets query to refresh the UI
			queryClient.invalidateQueries({
				queryKey: [["budget", "getBudgets"]],
			});
		},
		onError: (error) => {
			console.error("Failed to save budget:", error);
		},
	});

	const deleteBudget = api.budget.deleteBudget.useMutation({
		onSuccess: () => {
			toast.success("Budget deleted successfully!");
			// Invalidate the budgets query to refresh the UI
			queryClient.invalidateQueries({
				queryKey: [["budget", "getBudgets"]],
			});
		},
		onError: (error) => {
			console.error("Failed to delete budget:", error);
			toast.error("Failed to delete budget");
		},
	});

	// Update amount when pegged state changes and pegged is enabled
	useEffect(() => {
		if (isPegged) {
			setAmount(budget.actualSpend.toString());
		}
	}, [isPegged, budget.actualSpend]);

	// Focus input when expanded and not pegged
	useEffect(() => {
		if (isExpanded && !isPegged) {
			setTimeout(() => {
				inputRef.current?.focus();
				inputRef.current?.select();
			}, 100);
		}
	}, [isExpanded, isPegged]);

	// Guard against null category (shouldn't happen due to filtering in parent)
	if (!budget.category) {
		return null;
	}

	const categoryColor =
		CATEGORY_COLOR_MAP[
			budget.category.color as keyof typeof CATEGORY_COLOR_MAP
		] || "bg-gray-500";

	const remaining = budget.effectiveAmount - budget.actualSpend;
	const isOverBudget = remaining < 0;

	const handleSave = (pegStatus?: boolean) => {
		if (!budget.category) return;

		const pegToUse = pegStatus !== undefined ? pegStatus : isPegged;
		// For pegged budgets, amount is optional and defaults to 0
		const amountValue = pegToUse ? 0 : parseFloat(amount);
		if (!pegToUse && (Number.isNaN(amountValue) || amountValue < 0)) {
			return;
		}

		upsertBudget.mutate({
			categoryId: budget.category.id,
			amount: amountValue,
			period: selectedMonth,
			pegToActual: pegToUse,
		});
	};

	const handleRowClick = () => {
		if (!isMobile) {
			setIsExpanded(!isExpanded);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			handleSave();
		} else if (e.key === "Escape") {
			setIsExpanded(false);
			// Reset form state
			setAmount(budget.amount.toString());
			setIsPegged(budget.pegToActual);
		}
	};

	const handleChipClick = (value: number) => {
		setAmount(value.toString());
	};

	const handleDeleteBudget = () => {
		setShowDeleteDialog(true);
	};

	const handleConfirmDelete = () => {
		deleteBudget.mutate({
			budgetId: budget.id,
		});
		setShowDeleteDialog(false);
	};

	if (isMobile) {
		// Mobile: Read-only view
		return (
			<div className="flex items-center gap-3 rounded-lg border bg-card p-3">
				<div
					className={`flex h-8 w-8 items-center justify-center rounded-full font-semibold text-white text-xs ${categoryColor}`}
				>
					{budget.category.name.substring(0, 2).toUpperCase()}
				</div>
				<div className="min-w-0 flex-1">
					<div className="truncate font-medium">{budget.category.name}</div>
					<div
						className={`font-medium text-sm ${isOverBudget ? "text-destructive" : "text-foreground"}`}
					>
						{formatCurrency(budget.actualSpend, homeCurrency)} /{" "}
						{formatCurrency(budget.effectiveAmount, homeCurrency)}
					</div>
				</div>
			</div>
		);
	}

	// Desktop: Full interactive row with accordion
	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			{/* Collapsed Header */}
			<button
				className="group flex w-full cursor-pointer items-center gap-4 p-4 text-left transition-colors hover:bg-accent/50"
				onClick={handleRowClick}
				type="button"
			>
				{/* Category Icon */}
				<div
					className={`flex h-10 w-10 items-center justify-center rounded-full font-semibold text-sm text-white ${categoryColor}`}
				>
					{budget.category.name.substring(0, 2).toUpperCase()}
				</div>

				{/* Category Name */}
				<div className="min-w-0 flex-1">
					<h3 className="truncate font-medium">{budget.category.name}</h3>
				</div>

				{/* Bullet Chart */}
				<div className="max-w-xs flex-1">
					<BulletChart
						actualSpend={budget.actualSpend}
						budgetAmount={budget.effectiveAmount}
						color={budget.category.color}
						isOverBudget={isOverBudget}
						isPegged={budget.pegToActual}
					/>
				</div>

				{/* Amount Display */}
				<div className="flex min-w-32 items-center justify-end gap-1 whitespace-nowrap">
					<span
						className={`font-medium text-lg ${isOverBudget ? "text-destructive" : "text-foreground"}`}
					>
						{formatCurrency(budget.actualSpend, homeCurrency)}
					</span>
					<span className="text-muted-foreground text-sm">
						/ {formatCurrency(budget.effectiveAmount, homeCurrency)}
					</span>
				</div>
			</button>

			{/* Expanded Control Panel */}
			<div
				className={`overflow-hidden transition-all duration-300 ease-in-out ${
					isExpanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
				}`}
			>
				<div className="space-y-4 border-t bg-muted/50 p-4">
					{/* Zone A: Budget Amount Input */}
					<div className="space-y-2">
						<Label htmlFor="budget-amount">Budget Amount</Label>
						<div className="relative">
							<span className="absolute top-1/2 left-3 -translate-y-1/2 font-mono text-muted-foreground">
								$
							</span>
							<Input
								className={`border-none bg-transparent pl-6 font-mono text-3xl text-stone-200 outline-none placeholder:text-stone-400 ${
									isPegged ? "text-stone-600" : ""
								}`}
								disabled={isPegged}
								id="budget-amount"
								min="0"
								onBlur={() => handleSave()}
								onChange={(e) => setAmount(e.target.value)}
								onKeyDown={handleKeyDown}
								placeholder="$0.00"
								ref={inputRef}
								step="0.01"
								type="number"
								value={
									isPegged
										? new Intl.NumberFormat("en-US", {
												minimumFractionDigits: 2,
												maximumFractionDigits: 2,
											}).format(budget.actualSpend)
										: amount
								}
							/>
						</div>
					</div>

					{/* Zone B: Quick Suggestions */}
					{suggestions && (
						<div className="space-y-2">
							<Label>Quick Suggestions</Label>
							<QuickChips
								averageSpend={suggestions.averageSpend}
								disabled={isPegged}
								homeCurrency={homeCurrency}
								lastMonthSpend={suggestions.lastMonthSpend}
								onChipClick={handleChipClick}
							/>
						</div>
					)}

					{/* Zone C: Peg to Actual Spend Toggle */}
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<Switch
								checked={isPegged}
								onCheckedChange={(checked) => {
									setIsPegged(checked);
									// Save immediately when toggling peg status and collapse the row
									handleSave(checked);
									setIsExpanded(false);
								}}
							/>
							<Label className="font-medium text-sm">Peg to Actual Spend</Label>
						</div>
					</div>

					{/* Zone D: Delete Budget */}
					<div className="flex items-center justify-end border-t pt-2">
						<Button
							className="h-9 w-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
							disabled={deleteBudget.isPending}
							onClick={handleDeleteBudget}
							size="icon"
							type="button"
							variant="ghost"
						>
							<Trash2 className="h-4 w-4" />
							<span className="sr-only">Delete budget</span>
						</Button>
					</div>
				</div>
			</div>

			{/* Delete Confirmation Dialog */}
			<Dialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
				<DialogContent className="w-full max-w-full sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Delete Budget</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete this budget? This action cannot be
							undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							onClick={() => setShowDeleteDialog(false)}
							variant="outline"
						>
							Cancel
						</Button>
						<Button onClick={handleConfirmDelete} variant="destructive">
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
