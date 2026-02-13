"use client";

import { differenceInDays } from "date-fns";
import { Calendar, DollarSign } from "lucide-react";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { StatCard } from "~/components/ui/stat-card";
import { type RecurringTemplate } from "~/types/recurring";

interface RecurringStatsCardsProps {
	templates?: RecurringTemplate[];
	loading: boolean;
	homeCurrency: string;
}

export function RecurringStatsCards({
	templates,
	loading,
	homeCurrency,
}: RecurringStatsCardsProps) {
	const { formatCurrency } = useCurrencyFormatter();

	// Calculate Monthly Fixed Burn
	const monthlyBurn =
		templates
			?.filter((t) => t.isActive)
			.reduce((sum, t) => {
				const amount = Number(t.amountInHomeCurrency);
				switch (t.frequency) {
					case "YEARLY":
						return sum + amount / 12;
					case "WEEKLY":
						return sum + amount * 4;
					case "MONTHLY":
					default:
						return sum + amount;
				}
			}, 0) ?? 0;

	// Find Next Payment
	const nextPayment = templates
		?.filter((t) => t.isActive)
		.sort((a, b) => a.nextDueDate.getTime() - b.nextDueDate.getTime())[0];

	const daysUntilNext = nextPayment
		? differenceInDays(nextPayment.nextDueDate, new Date())
		: null;

	return (
		<div className="grid gap-4 sm:grid-cols-2">
			{/* Monthly Fixed Burn */}
			<StatCard
				description="Total recurring costs per month"
				icon={DollarSign}
				loading={loading}
				variant="blue"
				title="Monthly Fixed Burn"
				value={loading ? undefined : formatCurrency(monthlyBurn, homeCurrency)}
				subValue={
					loading
						? undefined
						: `≈ ${formatCurrency(monthlyBurn * 12, homeCurrency)} / year`
				}
			/>

			{/* Next Payment */}
			<StatCard
				description={
					!loading && nextPayment ? (
						<>
							{nextPayment.name} ·{" "}
							<span className="font-medium">
								{formatCurrency(
									Number(nextPayment.amount),
									nextPayment.currency,
								)}
							</span>
						</>
					) : null
				}
				icon={Calendar}
				loading={loading}
				variant={
					daysUntilNext !== null && daysUntilNext <= 0 ? "amber" : "violet"
				}
				title="Next Payment"
				value={
					loading
						? undefined
						: nextPayment
							? daysUntilNext !== null
								? daysUntilNext === 0
									? "Today"
									: daysUntilNext < 0
										? `${Math.abs(daysUntilNext)} days overdue`
										: `In ${daysUntilNext} days`
								: "Unknown"
							: "No payments"
				}
			/>
		</div>
	);
}
