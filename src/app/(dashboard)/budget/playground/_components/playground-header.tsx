"use client";

import { addMonths } from "date-fns";
import { RefreshCcw, Save } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { MonthStepper } from "~/components/date/MonthStepper";
import { Button } from "~/components/ui/button";
import { useCurrency } from "~/hooks/use-currency";
import { handleError } from "~/lib/handle-error";
import { api } from "~/trpc/react";
import { usePlayground } from "./playground-context";

export function PlaygroundHeaderActions() {
	const {
		selectedMonth,
		setSelectedMonth,
		simulatedBudgets,
		resetAll,
		isDirty,
	} = usePlayground();
	const { homeCurrency } = useCurrency();
	const utils = api.useUtils();

	const { data: serverTimeData } = api.system.getServerTime.useQuery(undefined, { staleTime: 30_000 });
	const budgetMaxDate = useMemo(() => {
		if (!serverTimeData?.serverTime) return undefined;
		return addMonths(new Date(serverTimeData.serverTime), 12);
	}, [serverTimeData?.serverTime]);

	const batchUpsertBudgets = api.budget.batchUpsertBudgets.useMutation();

	const handleApply = async () => {
		try {
			const payload = Object.entries(simulatedBudgets).map(
				([categoryId, amount]) => ({
					categoryId,
					amount,
					currency: homeCurrency,
					period: selectedMonth,
				}),
			);

			await batchUpsertBudgets.mutateAsync(payload);
			await utils.budget.getBudgets.invalidate({ month: selectedMonth });
			toast.success("Applied simulated budgets to live data!");
		} catch (error) {
			handleError(error, "Failed to apply budgets");
		}
	};

	return (
		<>
			<MonthStepper
				maxDate={budgetMaxDate}
				onChange={setSelectedMonth}
				value={selectedMonth}
			/>
			<Button
				disabled={!isDirty}
				onClick={resetAll}
				size="sm"
				variant="outline"
			>
				<RefreshCcw className="h-3.5 w-3.5" />
				<span className="hidden sm:inline">Reset</span>
			</Button>
			<Button
				disabled={!isDirty || batchUpsertBudgets.isPending}
				onClick={handleApply}
				size="sm"
				variant="default"
			>
				{batchUpsertBudgets.isPending ? (
					<RefreshCcw className="h-3.5 w-3.5 animate-spin" />
				) : (
					<Save className="h-3.5 w-3.5" />
				)}
				<span>
					{batchUpsertBudgets.isPending ? "Saving..." : "Apply Changes"}
				</span>
			</Button>
		</>
	);
}
