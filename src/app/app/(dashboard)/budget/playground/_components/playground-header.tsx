"use client";

import { ChevronLeft, ChevronRight, RefreshCcw, Save } from "lucide-react";
import { Button } from "~/components/ui/button";
import { usePlayground } from "./playground-context";
import { useCurrency } from "~/hooks/use-currency";
import { api } from "~/trpc/react";
import { toast } from "sonner";
import { handleError } from "~/lib/handle-error";

export function PlaygroundHeader() {
	const {
		selectedMonth,
		setSelectedMonth,
		simulatedBudgets,
		resetAll,
		isDirty,
	} = usePlayground();
	const { homeCurrency } = useCurrency();
	const utils = api.useUtils();

	const navigateMonth = (direction: "prev" | "next") => {
		const newDate = new Date(selectedMonth);
		if (direction === "prev") {
			newDate.setMonth(newDate.getMonth() - 1);
		} else {
			newDate.setMonth(newDate.getMonth() + 1);
		}
		setSelectedMonth(newDate);
	};

	const batchUpsertBudgets = api.budget.batchUpsertBudgets.useMutation();

	const handleApply = async () => {
		try {
			const payload = Object.entries(simulatedBudgets).map(([categoryId, amount]) => ({
				categoryId,
				amount,
				currency: homeCurrency,
				period: selectedMonth,
			}));

			await batchUpsertBudgets.mutateAsync(payload);
			
			await utils.budget.getBudgets.invalidate({ month: selectedMonth });
			toast.success("Applied simulated budgets to live data!");
		} catch (error) {
			handleError(error, "Failed to apply budgets");
		}
	};

	return (
		<div className="flex flex-col gap-6 border-b pb-8 sm:flex-row sm:items-center sm:justify-between">
			<div className="space-y-1">
				<div className="flex items-center gap-3">
					<div className="flex items-center rounded-lg bg-stone-100 p-1 dark:bg-stone-800">
						<Button
							className="h-8 w-8"
							onClick={() => navigateMonth("prev")}
							size="icon"
							variant="ghost"
						>
							<ChevronLeft className="h-4 w-4" />
						</Button>
						<span className="px-3 font-semibold text-sm">
							{selectedMonth.toLocaleDateString("en-US", {
								month: "short",
								year: "numeric",
							})}
						</span>
						<Button
							className="h-8 w-8"
							onClick={() => navigateMonth("next")}
							size="icon"
							variant="ghost"
						>
							<ChevronRight className="h-4 w-4" />
						</Button>
					</div>
				</div>
				<p className="text-muted-foreground">
					Simulate changes to your budget allocations and see their impact.
				</p>
			</div>

			<div className="flex flex-wrap items-center gap-4">
				<div className="flex items-center gap-2">
					<Button
						disabled={!isDirty}
						onClick={resetAll}
						size="sm"
						variant="outline"
					>
						<RefreshCcw className="mr-2 h-4 w-4" />
						Reset
					</Button>
					<Button
						disabled={!isDirty || batchUpsertBudgets.isPending}
						onClick={handleApply}
						size="sm"
						className="bg-indigo-600 hover:bg-indigo-700 text-white"
					>
						{batchUpsertBudgets.isPending ? (
							<RefreshCcw className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Save className="mr-2 h-4 w-4" />
						)}
						{batchUpsertBudgets.isPending ? "Saving..." : "Apply Changes"}
					</Button>
				</div>
			</div>
		</div>
	);
}
