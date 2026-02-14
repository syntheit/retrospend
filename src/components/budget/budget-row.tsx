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
import { cn, getCurrencySymbol } from "~/lib/utils";
import { api } from "~/trpc/react";
import type { Budget } from "~/types/budget-types";
import { CATEGORY_ICON_MAP } from "~/lib/icons";
import { BulletChart } from "./bullet-chart";
import { QuickChips } from "./quick-chips";

interface BudgetRowProps {
	budget: Budget;
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

	const { data: suggestions } = api.budget.getBudgetSuggestions.useQuery(
		{ categoryId: budget.category?.id ?? "", currency: budget.currency },
		{ enabled: isExpanded && !!budget.category },
	);

	const upsertBudget = api.budget.upsertBudget.useMutation({
		onSuccess: (data) => {
			if (data.pegToActual !== previousPegStatus) {
				toast.success(
					`Budget moved to ${data.pegToActual ? "Fixed" : "Variable"} section`,
				);
			}
			setPreviousPegStatus(data.pegToActual);
			setIsPegged(data.pegToActual);
			queryClient.invalidateQueries({
				queryKey: [["budget", "getBudgets"]],
			});
		},
		onError: (error) => {
			toast.error(error.message || "Failed to save budget");
		},
	});

	const deleteBudget = api.budget.deleteBudget.useMutation({
		onSuccess: () => {
			toast.success("Budget deleted successfully!");
			queryClient.invalidateQueries({
				queryKey: [["budget", "getBudgets"]],
			});
		},
		onError: (error) => {
			toast.error(error.message || "Failed to delete budget");
		},
	});

	useEffect(() => {
		if (isPegged) {
			setAmount(budget.actualSpend.toString());
		}
	}, [isPegged, budget.actualSpend]);

	useEffect(() => {
		if (isExpanded && !isPegged) {
			setTimeout(() => {
				inputRef.current?.focus();
				inputRef.current?.select();
			}, 100);
		}
	}, [isExpanded, isPegged]);

	if (!budget.category) {
		return null;
	}

	/* categoryColor is handled via MUTED_COLOR_MAP in newer patterns, but we keep it simple here */

	const remaining = budget.effectiveAmount - budget.actualSpend;
	const isOverBudget = remaining < 0;

	const handleSave = (pegStatus?: boolean) => {
		if (!budget.category) return;

		const pegToUse = pegStatus !== undefined ? pegStatus : isPegged;
		const amountValue = pegToUse ? 0 : parseFloat(amount);
		if (!pegToUse && (Number.isNaN(amountValue) || amountValue < 0)) {
			return;
		}

		upsertBudget.mutate({
			categoryId: budget.category.id,
			amount: amountValue,
			currency: budget.currency,
			period: selectedMonth,
			pegToActual: pegToUse,
		});
	};

	const handleRowClick = () => {
		setIsExpanded(!isExpanded);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			handleSave();
		} else if (e.key === "Escape") {
			setIsExpanded(false);
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

	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			<button
				className="group flex w-full cursor-pointer items-center gap-3 p-3 text-left transition-colors hover:bg-accent/50 sm:gap-4 sm:p-4"
				onClick={handleRowClick}
				type="button"
			>
				<div
					className={cn(
						"flex h-8 w-8 shrink-0 items-center justify-center rounded-full sm:h-9 sm:w-9",
						"bg-primary/10 text-primary"
					)}
				>
					{(() => {
						const Icon = (CATEGORY_ICON_MAP[budget.category.name] || CATEGORY_ICON_MAP.Misc) as React.ElementType;
						return <Icon className="h-4 w-4" />;
					})()}
				</div>

				<div className="min-w-0 flex-1">
					<h3 className="truncate font-medium text-sm sm:text-base tracking-tight">
						{budget.category.name}
					</h3>
				</div>

				{!isMobile && (
					<div className="hidden max-w-xs flex-1 sm:block">
						<BulletChart
							actualSpend={budget.actualSpend}
							budgetAmount={budget.effectiveAmount}
							color={budget.category.color}
							isOverBudget={isOverBudget}
							isPegged={budget.pegToActual}
						/>
					</div>
				)}

				<div className="flex items-center justify-end gap-1 whitespace-nowrap text-right tabular-nums">
					<span
						className={`font-medium sm:text-lg ${isOverBudget ? "text-amber-500" : "text-foreground"}`}
					>
						{formatCurrency(budget.actualSpend, budget.currency)}
					</span>
					<span className="text-muted-foreground text-xs sm:text-sm">
						/ {formatCurrency(budget.effectiveAmount, budget.currency)}
					</span>
				</div>
			</button>

			<div
				className={`overflow-hidden transition-all duration-300 ease-in-out ${
					isExpanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
				}`}
			>
				<div className="space-y-4 border-t bg-muted/50 p-4">
					<div className="space-y-2">
						<Label htmlFor="budget-amount">Budget Amount</Label>
						<div className="relative">
							<span className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground tabular-nums">
								{getCurrencySymbol(budget.currency)}
							</span>
							<Input
								className={`border-none bg-transparent pl-6 text-2xl text-foreground outline-none placeholder:text-muted-foreground tabular-nums sm:text-3xl ${
									isPegged ? "text-muted-foreground" : ""
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

					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<Switch
								checked={isPegged}
								onCheckedChange={(checked) => {
									setIsPegged(checked);
									handleSave(checked);
									setIsExpanded(false);
								}}
							/>
							<Label className="font-medium text-sm">Peg to Actual Spend</Label>
						</div>
					</div>

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
