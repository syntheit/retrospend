"use client";

import { differenceInDays } from "date-fns";
import { Calendar, DollarSign } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { cn } from "~/lib/utils";

interface RecurringTemplate {
	id: string;
	name: string;
	amount: number;
	amountInHomeCurrency: number;
	currency: string;
	frequency: "WEEKLY" | "MONTHLY" | "YEARLY";
	nextDueDate: Date;
	isActive: boolean;
}

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
				theme="blue"
				title="Monthly Fixed Burn"
				value={loading ? undefined : formatCurrency(monthlyBurn, homeCurrency)}
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
				theme={
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

// Reusable StatCard Component
interface StatCardProps {
	description?: React.ReactNode;
	icon: React.ElementType;
	loading: boolean;
	theme: "blue" | "violet" | "amber";
	title: string;
	value?: React.ReactNode;
}

function StatCard({
	description,
	icon: Icon,
	loading,
	theme,
	title,
	value,
}: StatCardProps) {
	const themes = {
		amber: {
			cardInfo:
				"border-amber-200/50 bg-gradient-to-br from-amber-50 to-white hover:shadow-lg hover:shadow-amber-100 dark:border-amber-900/50 dark:from-amber-950/30 dark:to-card",
			circle: "bg-amber-500/10",
			textSub: "text-amber-700 dark:text-amber-400",
			textMain: "text-amber-900 dark:text-amber-100",
			iconBg: "bg-amber-100 dark:bg-amber-900/50",
			iconColor: "text-amber-600 dark:text-amber-400",
			desc: "text-amber-600/80 dark:text-amber-400/80",
		},
		blue: {
			cardInfo:
				"border-blue-200/50 bg-gradient-to-br from-blue-50 to-white hover:shadow-lg hover:shadow-blue-100 dark:border-blue-900/50 dark:from-blue-950/30 dark:to-card",
			circle: "bg-blue-500/10",
			textSub: "text-blue-700 dark:text-blue-400",
			textMain: "text-blue-900 dark:text-blue-100",
			iconBg: "bg-blue-100 dark:bg-blue-900/50",
			iconColor: "text-blue-600 dark:text-blue-400",
			desc: "text-blue-600/80 dark:text-blue-400/80",
		},
		violet: {
			cardInfo:
				"border-violet-200/50 bg-gradient-to-br from-violet-50 to-white hover:shadow-lg hover:shadow-violet-100 dark:border-violet-900/50 dark:from-violet-950/30 dark:to-card",
			circle: "bg-violet-500/10",
			textSub: "text-violet-700 dark:text-violet-400",
			textMain: "text-violet-900 dark:text-violet-100",
			iconBg: "bg-violet-100 dark:bg-violet-900/50",
			iconColor: "text-violet-600 dark:text-violet-400",
			desc: "text-violet-600/80 dark:text-violet-400/80",
		},
	};

	const s = themes[theme];

	return (
		<Card
			className={cn(
				"group relative overflow-hidden transition-all duration-300",
				s.cardInfo,
			)}
		>
			{/* Decorative Circle */}
			<div
				className={cn(
					"absolute top-0 right-0 h-20 w-20 translate-x-8 -translate-y-8 rounded-full transition-transform duration-300 group-hover:scale-150",
					s.circle,
				)}
			/>

			<CardContent className="relative p-4">
				<div className="flex items-start justify-between">
					<div className="space-y-1">
						<p className={cn("font-medium text-sm", s.textSub)}>{title}</p>
						{loading ? (
							<Skeleton className={cn("h-8 w-28")} />
						) : (
							<p
								className={cn("font-bold text-2xl tracking-tight", s.textMain)}
							>
								{value}
							</p>
						)}
					</div>
					<div className={cn("rounded-lg p-2.5", s.iconBg)}>
						<Icon className={cn("h-5 w-5", s.iconColor)} />
					</div>
				</div>

				{!loading && description && (
					<div className={cn("mt-2 text-sm", s.desc)}>{description}</div>
				)}
			</CardContent>
		</Card>
	);
}
