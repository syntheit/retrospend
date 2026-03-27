"use client";

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
import { getCategoryIcon } from "~/lib/category-icons";
import { cn, getCurrencySymbol } from "~/lib/utils";
import { api } from "~/trpc/react";
import type { Budget } from "~/types/budget-types";
import { BulletChart } from "./bullet-chart";
import { QuickChips } from "./quick-chips";

interface BudgetRowProps {
	budget: Budget;
	selectedMonth: Date;
	homeCurrency: string;
	startExpanded?: boolean;
}

export function BudgetRow({
	budget,
	selectedMonth,
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
	const utils = api.useUtils();
	const inputRef = useRef<HTMLInputElement>(null);

	const { data: suggestions } = api.budget.getBudgetSuggestions.useQuery(
		{ categoryId: budget.category?.id ?? "", currency: budget.currency },
		{ enabled: isExpanded && !!budget.category },
	);

	const upsertBudget = api.budget.upsertBudget.useMutation({
		onSuccess: (data) => {
			if (data.pegToActual !== previousPegStatus) {
				toast.success(
					`Budget moved to ${data.pegToActual ? "Fixed / Pegged" : "Variable / Managed"} section`,
				);
			}
			setPreviousPegStatus(data.pegToActual);
			setIsPegged(data.pegToActual);
			void utils.budget.getBudgets.invalidate();
		},
		onError: (error) => {
			toast.error(error.message || "Failed to save budget");
		},
	});

	const deleteBudget = api.budget.deleteBudget.useMutation({
		onSuccess: () => {
			toast.success("Budget deleted successfully!");
			void utils.budget.getBudgets.invalidate();
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
			<Button
				aria-expanded={isExpanded}
				className="group flex h-auto w-full items-center gap-3 rounded-none p-3 text-left hover:bg-accent/50 sm:gap-4 sm:p-4"
				onClick={handleRowClick}
				type="button"
				variant="ghost"
			>
				<div
					className={cn(
						"flex h-8 w-8 shrink-0 items-center justify-center rounded-full sm:h-9 sm:w-9",
						"bg-primary/10 text-primary",
					)}
				>
					{(() => {
						const Icon = getCategoryIcon(
							budget.category.name,
							budget.category.icon,
						);
						return <Icon className="h-4 w-4" />;
					})()}
				</div>

				<div className="min-w-0 flex-1">
					<h3 className="truncate font-medium text-sm tracking-tight sm:text-base">
						{budget.category.name}
					</h3>
				</div>

				<div className="max-w-[40px] flex-1 sm:max-w-xs">
					<BulletChart
						actualSpend={budget.actualSpend}
						budgetAmount={budget.effectiveAmount}
						color={budget.category.color}
						isOverBudget={isOverBudget}
						isPegged={budget.pegToActual}
					/>
				</div>

				<div className="flex items-center justify-end gap-1 whitespace-nowrap text-right tabular-nums">
					<span
						className={cn(
							"font-medium sm:text-lg",
							isOverBudget ? "text-amber-500" : "text-foreground",
						)}
					>
						{formatCurrency(budget.actualSpend, budget.currency)}
					</span>
					<span className="text-muted-foreground text-xs sm:text-sm">
						/ {formatCurrency(budget.effectiveAmount, budget.currency)}
					</span>
				</div>
			</Button>

			<div
				className={cn(
					"grid transition-all duration-300 ease-in-out",
					isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
				)}
			>
				<div className="overflow-hidden">
				<div className="space-y-4 border-t bg-muted/50 p-4">
					<div className="space-y-2">
						<Label htmlFor={`budget-amount-${budget.id}`}>Budget Amount</Label>
						<div className="relative">
							<span className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground tabular-nums">
								{getCurrencySymbol(budget.currency)}
							</span>
							<Input
								className={cn(
									"border-none bg-transparent pl-6 text-2xl text-foreground tabular-nums outline-none placeholder:text-muted-foreground sm:text-3xl",
									isPegged && "text-muted-foreground",
								)}
								disabled={isPegged}
								id={`budget-amount-${budget.id}`}
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
						<Button
							disabled={deleteBudget.isPending}
							onClick={handleConfirmDelete}
							variant="destructive"
						>
							{deleteBudget.isPending ? "Deleting..." : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
