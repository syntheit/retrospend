"use client";

import { TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { toMonthlyEquivalent } from "~/lib/recurring";
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
	const t = useTranslations("recurring");
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
		monthly: t("perMonth"),
		quarterly: t("perQuarter"),
		annual: t("perYear"),
	};

	if (loading) {
		return (
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<div className="flex items-center gap-2 text-muted-foreground text-sm">
						<TrendingUp className="h-4 w-4" />
						<span>{t("projectedSpending")}</span>
					</div>
				</CardHeader>
				<CardContent>
					<Skeleton className="h-8 w-32" />
				</CardContent>
			</Card>
		);
	}

	if (activeTemplates.length === 0) return null;

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<div className="flex items-center gap-2 text-muted-foreground text-sm">
					<TrendingUp className="h-4 w-4" />
					<span>{t("projectedSpending")}</span>
				</div>
				<ToggleGroup
					onValueChange={(value) => {
						if (value) setPeriod(value as ProjectionPeriod);
					}}
					size="sm"
					type="single"
					value={period}
				>
					{(["monthly", "quarterly", "annual"] as const).map((p) => (
						<ToggleGroupItem className="cursor-pointer" key={p} value={p}>
							{t(`period_${p}`)}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</CardHeader>
			<CardContent>
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
						{t("mostExpensive", {
							name: mostExpensive.template.name,
							amount: formatCurrency(mostExpensive.monthlyAmount, homeCurrency),
						})}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
