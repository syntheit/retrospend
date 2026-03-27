"use client";

import { differenceInDays } from "date-fns";
import { Calendar, DollarSign } from "lucide-react";
import { StatCard } from "~/components/ui/stat-card";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { toMonthlyEquivalent } from "~/lib/recurring";
import type { RecurringTemplate } from "~/types/recurring";

interface RecurringStatsCardsProps {
	templates?: RecurringTemplate[];
	loading: boolean;
	homeCurrency: string;
	serverTime?: Date;
}

export function RecurringStatsCards({
	templates,
	loading,
	homeCurrency,
	serverTime,
}: RecurringStatsCardsProps) {
	const { formatCurrency } = useCurrencyFormatter();
	const now = serverTime ?? new Date();

	// Calculate Monthly Fixed Burn
	const monthlyBurn =
		templates
			?.filter((t) => t.isActive)
			.reduce(
				(sum, t) =>
					sum +
					toMonthlyEquivalent(
						Number(t.amountInHomeCurrency),
						t.frequency,
					),
				0,
			) ?? 0;

	// Find Next Payment
	const nextPayment = templates
		?.filter((t) => t.isActive)
		.sort((a, b) => a.nextDueDate.getTime() - b.nextDueDate.getTime())[0];

	const daysUntilNext = nextPayment
		? differenceInDays(nextPayment.nextDueDate, now)
		: null;

	return (
		<div className="grid gap-4 sm:grid-cols-2">
			{/* Monthly Fixed Burn */}
			<StatCard
				description="Total recurring costs per month"
				icon={DollarSign}
				loading={loading}
				subValue={
					loading
						? undefined
						: `≈ ${formatCurrency(monthlyBurn * 12, homeCurrency)} / year`
				}
				title="Monthly Fixed Burn"
				value={loading ? undefined : formatCurrency(monthlyBurn, homeCurrency)}
				variant="blue"
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
				variant={
					daysUntilNext !== null && daysUntilNext <= 0 ? "amber" : "violet"
				}
			/>
		</div>
	);
}
