"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CategoryPicker } from "~/components/category-picker";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";

import type { Category } from "~/types/budget-types";

interface AddBudgetRowProps {
	unbudgetedCategories: Category[];
	selectedMonth: Date;
	homeCurrency: string;
	isMobile: boolean;
	onBudgetAdded?: (budgetId: string) => void;
}

export function AddBudgetRow({
	unbudgetedCategories,
	selectedMonth,
	homeCurrency,
	isMobile,
	onBudgetAdded,
}: AddBudgetRowProps) {
	const [isActive, setIsActive] = useState(false);
	const queryClient = useQueryClient();

	const upsertBudget = api.budget.upsertBudget.useMutation({
		onSuccess: (data) => {
			queryClient.invalidateQueries({
				queryKey: [["budget", "getBudgets"]],
			});
			if (data && onBudgetAdded) {
				onBudgetAdded(data.id);
			}
			setIsActive(false);
		},
		onError: (error) => {
			toast.error(error.message || "Failed to add budget");
		},
	});

	const handleCategorySelect = (categoryId: string) => {
		if (categoryId) {
			upsertBudget.mutate({
				categoryId,
				amount: 0,
				currency: homeCurrency,
				period: selectedMonth,
				pegToActual: false,
			});
		}
	};

	return (
		<div
			className={
				isMobile
					? "w-full"
					: "overflow-hidden rounded-lg border border-border border-dashed bg-card"
			}
		>
			{!isActive ? (
				isMobile ? (
					<Button
						className="w-full border-border border-dashed hover:bg-accent/50"
						onClick={() => setIsActive(true)}
						variant="outline"
					>
						<Plus className="mr-2 h-4 w-4" />
						Add Category Budget
					</Button>
				) : (
					<button
						className="group flex w-full cursor-pointer items-center justify-center gap-3 p-4 text-left transition-colors hover:bg-accent/50"
						onClick={() => setIsActive(true)}
						type="button"
					>
						<Plus className="h-5 w-5 text-muted-foreground" />
						<span className="text-muted-foreground">Add Category Budget</span>
					</button>
				)
			) : (
				<div className={isMobile ? "rounded-lg border bg-card p-3" : "p-4"}>
					<CategoryPicker
						categories={unbudgetedCategories}
						onValueChange={handleCategorySelect}
						placeholder="Select a category..."
					/>
				</div>
			)}
		</div>
	);
}
