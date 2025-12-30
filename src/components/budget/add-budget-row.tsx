"use client";

import { Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { CategoryPicker } from "~/components/category-picker";
import { api } from "~/trpc/react";

interface Category {
	id: string;
	name: string;
	color: string;
}

interface AddBudgetRowProps {
	unbudgetedCategories: Category[];
	selectedMonth: Date;
	isMobile: boolean;
	onBudgetAdded?: (budgetId: string) => void;
}

export function AddBudgetRow({
	unbudgetedCategories,
	selectedMonth,
	isMobile,
	onBudgetAdded,
}: AddBudgetRowProps) {
	const [isActive, setIsActive] = useState(false);
	const queryClient = useQueryClient();

	const upsertBudget = api.budget.upsertBudget.useMutation({
		onSuccess: (data) => {
			// Invalidate the budgets query to refresh the UI
			queryClient.invalidateQueries({
				queryKey: [["budget", "getBudgets"]],
			});
			// Call callback with newly created budget ID
			if (data && onBudgetAdded) {
				onBudgetAdded(data.id);
			}
			// Reset to inactive state
			setIsActive(false);
		},
		onError: (error) => {
			console.error("Failed to add budget:", error);
		},
	});

	const handleCategorySelect = (categoryId: string) => {
		if (categoryId) {
			upsertBudget.mutate({
				categoryId,
				amount: 0, // Start with $0
				period: selectedMonth,
				pegToActual: false, // Start as variable/managed
			});
		}
	};

	if (isMobile) {
		// Mobile: Simple button
		return (
			<Button
				className="w-full border-dashed border-border hover:bg-accent/50"
				onClick={() => setIsActive(true)}
				variant="outline"
			>
				<Plus className="mr-2 h-4 w-4" />
				Add Category Budget
			</Button>
		);
	}

	// Desktop: Full interactive row
	return (
		<div className="rounded-lg border border-dashed border-border bg-card overflow-hidden">
			{!isActive ? (
				// Inactive state
				<button
					className="group flex w-full cursor-pointer items-center justify-center gap-3 p-4 text-left transition-colors hover:bg-accent/50"
					onClick={() => setIsActive(true)}
					type="button"
				>
					<Plus className="h-5 w-5 text-muted-foreground" />
					<span className="text-muted-foreground">Add Category Budget</span>
				</button>
			) : (
				// Active state with category picker
				<div className="p-4">
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
