"use client";

import { TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { toMonthlyEquivalent } from "~/lib/recurring";
import { cn } from "~/lib/utils";
import type { RecurringTemplate } from "~/types/recurring";

type ProjectionPeriod = "monthly" | "quarterly" | "annual";

interface RecurringProjectionsProps {
	templates?: RecurringTemplate[];
	homeCurrency: string;
	loading: boolean;
}

export function RecurringProjections({
	templates,
	homeCurrency,
	loading,
}: RecurringProjectionsProps) {
	const [period, setPeriod] = useState<ProjectionPeriod>("monthly");
	const { formatCurrency } = useCurrencyFormatter();

	const activeTemplates = useMemo(
		() => templates?.filter((t) => t.isActive) ?? [],
		[templates],
	);

	const monthlyEquivalents = useMemo(
		() =>
			activeTemplates.map((t) => ({
				template: t,
				monthlyAmount: toMonthlyEquivalent(
					Number(t.amountInHomeCurrency),
					t.frequency,
				),
			})),
		[activeTemplates],
	);

	const totalMonthly = useMemo(
		() => monthlyEquivalents.reduce((sum, t) => sum + t.monthlyAmount, 0),
		[monthlyEquivalents],
	);

	const mostExpensive = useMemo(
		() =>
			monthlyEquivalents.reduce<(typeof monthlyEquivalents)[number] | null>(
				(max, t) => (t.monthlyAmount > (max?.monthlyAmount ?? 0) ? t : max),
				null,
			),
		[monthlyEquivalents],
	);

	const multiplier = period === "monthly" ? 1 : period === "quarterly" ? 3 : 12;
	const projectedTotal = totalMonthly * multiplier;

	const periodLabels: Record<ProjectionPeriod, string> = {
		monthly: "/ month",
		quarterly: "/ quarter",
		annual: "/ year",
	};

	if (loading) {
		return (
			<Card className="border border-border bg-card">
				<CardContent className="p-5">
					<div className="h-16 animate-pulse rounded bg-muted/30" />
				</CardContent>
			</Card>
		);
	}

	if (activeTemplates.length === 0) return null;

	return (
		<Card className="border border-border bg-card">
			<CardContent className="p-5">
				{/* Header with toggle */}
				<div className="mb-3 space-y-2">
					<div className="flex items-center gap-2 text-muted-foreground text-sm">
						<TrendingUp className="h-4 w-4" />
						<span>Projected Spending</span>
					</div>
					<div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
						{(["monthly", "quarterly", "annual"] as const).map((p) => (
							<Button
								className={cn(
									"flex-1 rounded-md px-2.5 py-1 text-xs",
									period === p
										? "bg-background text-foreground shadow-sm"
										: "text-muted-foreground hover:text-foreground",
								)}
								key={p}
								onClick={() => setPeriod(p)}
								type="button"
								variant="ghost"
								size="sm"
							>
								{p.charAt(0).toUpperCase() + p.slice(1)}
							</Button>
						))}
					</div>
				</div>

				{/* Projected total */}
				<div className="font-bold text-2xl tabular-nums tracking-tight">
					{formatCurrency(projectedTotal, homeCurrency)}
					<span className="ml-1 font-normal text-muted-foreground text-sm">
						{periodLabels[period]}
					</span>
				</div>

				{/* Most expensive */}
				{mostExpensive && (
					<p className="mt-1 text-muted-foreground text-xs">
						Most expensive: {mostExpensive.template.name} at{" "}
						{formatCurrency(mostExpensive.monthlyAmount, homeCurrency)}
						/mo
					</p>
				)}
			</CardContent>
		</Card>
	);
}
