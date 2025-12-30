"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Lock, LockOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { CATEGORY_COLOR_MAP } from "~/lib/constants";
import { api } from "~/trpc/react";
import { QuickChips } from "./quick-chips";

interface BudgetModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mode: "add" | "edit";
	category: {
		id: string;
		name: string;
		color: string;
	};
	budget?: {
		id: string;
		amount: number;
		pegToActual: boolean;
	};
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
	const [isPegged, setIsPegged] = useState(budget?.pegToActual || false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	// Reset form when modal opens
	useEffect(() => {
		if (open) {
			setAmount(budget?.amount?.toString() || "");
			setIsPegged(budget?.pegToActual || false);
			setIsSubmitting(false);

			// Focus input after a short delay to ensure modal is rendered (skip if pegged)
			if (!budget?.pegToActual) {
				setTimeout(() => {
					inputRef.current?.focus();
					inputRef.current?.select();
				}, 100);
			}
		}
	}, [open, budget]);

	// Get suggestions for quick chips (only when editing existing budgets)
	const { data: suggestions } = api.budget.getBudgetSuggestions.useQuery(
		{ categoryId: category.id },
		{ enabled: open && mode === "edit" },
	);

	const upsertBudget = api.budget.upsertBudget.useMutation({
		onSuccess: () => {
			setIsSubmitting(false);
			onOpenChange(false);
			// Invalidate the budgets query to refresh the UI
			queryClient.invalidateQueries({
				queryKey: [["budget", "getBudgets"]],
			});
		},
		onError: (error) => {
			console.error("Failed to save budget:", error);
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
			period: selectedMonth,
			pegToActual: isPegged,
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
						<Label htmlFor="budget-amount">
							Budget Amount{" "}
							{isPegged && (
								<span className="text-muted-foreground">(optional)</span>
							)}
						</Label>
						<div className="relative">
							<span className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
								$
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
						{isPegged && (
							<p className="text-muted-foreground text-sm">
								Amount will be automatically set to match your actual spending
								this month.
							</p>
						)}
					</div>

					{mode === "edit" && suggestions && (
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

					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Button
								className={`h-8 w-8 p-0 ${isPegged ? "text-primary" : "text-muted-foreground"}`}
								onClick={() => setIsPegged(!isPegged)}
								size="sm"
								type="button"
								variant="ghost"
							>
								{isPegged ? (
									<Lock className="h-4 w-4" />
								) : (
									<LockOpen className="h-4 w-4" />
								)}
							</Button>
							<span className="text-muted-foreground text-sm">
								{isPegged ? "Pegged to actual spend" : "Fixed budget amount"}
							</span>
						</div>
					</div>

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
