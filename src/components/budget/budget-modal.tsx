"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { CATEGORY_COLOR_MAP } from "~/lib/constants";
import { cn, getCurrencySymbol } from "~/lib/utils";
import { api } from "~/trpc/react";
import type { Budget, Category } from "~/types/budget-types";
import { QuickChips } from "./quick-chips";

type BudgetType = "FIXED" | "PEG_TO_ACTUAL" | "PEG_TO_LAST_MONTH";

interface BudgetModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mode: "add" | "edit";
	category: Category;
	budget?: Pick<Budget, "id" | "amount" | "currency" | "pegToActual" | "type">;
	selectedMonth: Date;
	homeCurrency: string;
}

export function BudgetModal({
	open,
	onOpenChange,
	mode,
	category,
	budget,
	selectedMonth,
	homeCurrency,
}: BudgetModalProps) {
	const queryClient = useQueryClient();
	const [amount, setAmount] = useState(budget?.amount?.toString() || "");
	const [budgetType, setBudgetType] = useState<BudgetType>(
		budget?.type || (budget?.pegToActual ? "PEG_TO_ACTUAL" : "FIXED"),
	);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	// Determine if input should be disabled based on type
	const isPegged = budgetType !== "FIXED";

	useEffect(() => {
		if (open) {
			setAmount(budget?.amount?.toString() || "");
			setBudgetType(
				budget?.type || (budget?.pegToActual ? "PEG_TO_ACTUAL" : "FIXED"),
			);
			setIsSubmitting(false);

			// Focus input after a short delay to ensure modal is rendered (skip if pegged)
			if (
				!budget?.pegToActual &&
				(!budget?.type || budget.type === "FIXED")
			) {
				setTimeout(() => {
					inputRef.current?.focus();
					inputRef.current?.select();
				}, 100);
			}
		}
	}, [open, budget]);

	// Use budget's currency when editing, homeCurrency when adding
	const budgetCurrency = budget?.currency ?? homeCurrency;

	// Get suggestions for quick chips (only when editing existing budgets)
	const { data: suggestions } = api.budget.getBudgetSuggestions.useQuery(
		{ categoryId: category.id, currency: budgetCurrency },
		{ enabled: open && mode === "edit" },
	);

	const upsertBudget = api.budget.upsertBudget.useMutation({
		onSuccess: () => {
			setIsSubmitting(false);
			onOpenChange(false);
			queryClient.invalidateQueries({
				queryKey: [["budget", "getBudgets"]],
			});
		},
		onError: (error) => {
			toast.error(error.message || "Failed to save budget");
			setIsSubmitting(false);
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		// For pegged budgets, amount is optional and defaults to 0
		const amountValue = isPegged ? 0 : parseFloat(amount);
		if (!isPegged && (Number.isNaN(amountValue) || amountValue < 0)) {
			return;
		}

		setIsSubmitting(true);
		upsertBudget.mutate({
			categoryId: category.id,
			amount: amountValue,
			currency: budgetCurrency,
			period: selectedMonth,
			pegToActual: budgetType === "PEG_TO_ACTUAL", // Maintain legacy field
			type: budgetType,
		});
	};

	const handleChipClick = (value: number) => {
		setAmount(value.toString());
	};

	const categoryColor =
		CATEGORY_COLOR_MAP[category.color as keyof typeof CATEGORY_COLOR_MAP] ||
		"bg-gray-500";

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-3">
						<div
							className={`flex h-8 w-8 items-center justify-center rounded-full font-semibold text-sm text-white ${categoryColor}`}
						>
							{category.name.substring(0, 2).toUpperCase()}
						</div>
						{mode === "add" ? "Add Budget" : "Edit Budget"} - {category.name}
					</DialogTitle>
				</DialogHeader>

				<form className="space-y-4" onSubmit={handleSubmit}>
					<div className="space-y-2">
						<Label>Budget Method</Label>
						<Select
							onValueChange={(val) => setBudgetType(val as BudgetType)}
							value={budgetType}
						>
							<SelectTrigger>
								<SelectValue placeholder="Select budget method" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="FIXED">
									<div className="flex flex-col">
										<span className="font-medium">Fixed Amount</span>
										<span className="text-muted-foreground text-xs">
											Set a specific limit
										</span>
									</div>
								</SelectItem>
								<SelectItem value="PEG_TO_ACTUAL">
									<div className="flex flex-col">
										<span className="font-medium">Peg to Actual</span>
										<span className="text-muted-foreground text-xs">
											Budget always matches spend
										</span>
									</div>
								</SelectItem>
								<SelectItem value="PEG_TO_LAST_MONTH">
									<div className="flex flex-col">
										<span className="font-medium">Peg to Last Month</span>
										<span className="text-muted-foreground text-xs">
											Use last month's spend as limit
										</span>
									</div>
								</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className={cn("space-y-2", isPegged && "opacity-50")}>
						<Label htmlFor="budget-amount">
							Budget Amount{" "}
							{isPegged && (
								<span className="text-muted-foreground">(auto-calculated)</span>
							)}
						</Label>
						<div className="relative">
							<span className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
								{getCurrencySymbol(budgetCurrency)}
							</span>
							<Input
								className="pl-6"
								disabled={isPegged}
								id="budget-amount"
								min="0"
								onChange={(e) => setAmount(e.target.value)}
								placeholder={isPegged ? "Auto-calculated" : "0.00"}
								ref={inputRef}
								required={!isPegged}
								step="0.01"
								type="number"
								value={amount}
							/>
						</div>
					</div>

					{mode === "edit" && suggestions && !isPegged && (
						<div className="space-y-2">
							<Label>Quick Suggestions</Label>
							<QuickChips
								averageSpend={suggestions.averageSpend}
								homeCurrency={homeCurrency}
								lastMonthSpend={suggestions.lastMonthSpend}
								onChipClick={handleChipClick}
							/>
						</div>
					)}

					<div className="flex justify-end gap-2 pt-4">
						<Button
							disabled={isSubmitting}
							onClick={() => onOpenChange(false)}
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button disabled={isSubmitting} type="submit">
							{isSubmitting
								? "Saving..."
								: mode === "add"
									? "Add Budget"
									: "Save Changes"}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
