"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent } from "~/components/ui/card";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { cn } from "~/lib/utils";

interface SummaryCardProps {
	title: string;
	value: number | string;
	icon?: LucideIcon;
	variant?: "default" | "success" | "danger";
	currency?: string;
	footer?: ReactNode;
}

/**
 * SummaryCard - A reusable card for displaying key metrics in the wealth dashboard.
 * Supports three variants: dark (hero), success (emerald), and danger (amber).
 */
export function SummaryCard({
	title,
	value,
	icon: Icon,
	variant = "default",
	currency = "USD",
	footer,
}: SummaryCardProps) {
	const { formatCurrency } = useCurrencyFormatter();

	const formattedValue = typeof value === "number" ? formatCurrency(value, currency) : value;

	if (variant === "default") {
		return (
			<Card className="relative overflow-hidden border-0 bg-gradient-to-br from-stone-800 via-stone-700 to-stone-900 text-white shadow-xl dark:from-stone-900 dark:via-stone-800 dark:to-black">
				<div className="absolute top-0 right-0 h-32 w-32 translate-x-10 -translate-y-10 rounded-full bg-white/5" />
				<CardContent className="relative p-5">
					<div className="space-y-4">
						<div className="space-y-1">
							<p className="font-medium text-sm text-stone-300">{title}</p>
							<p className="font-bold text-3xl tracking-tight">{formattedValue}</p>
						</div>
						{footer && (
							<div className="flex w-fit items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 backdrop-blur-sm">
								{footer}
							</div>
						)}
					</div>
				</CardContent>
			</Card>
		);
	}

	const isSuccess = variant === "success";

	return (
		<Card
			className={cn(
				"group relative overflow-hidden transition-all duration-300 hover:shadow-lg",
				isSuccess
					? "border-emerald-200/50 bg-gradient-to-br from-emerald-50 to-white hover:shadow-emerald-100 dark:border-emerald-900/50 dark:from-emerald-950/30 dark:to-card"
					: "border-amber-200/50 bg-gradient-to-br from-amber-50 to-white hover:shadow-amber-100 dark:border-amber-900/50 dark:from-amber-950/30 dark:to-card",
			)}
		>
			<div
				className={cn(
					"absolute top-0 right-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full transition-transform duration-300 group-hover:scale-150",
					isSuccess ? "bg-emerald-500/10" : "bg-amber-500/10",
				)}
			/>
			<CardContent className="relative p-5">
				<div className="flex items-start justify-between">
					<div className="space-y-1">
						<p
							className={cn(
								"font-medium text-sm",
								isSuccess
									? "text-emerald-700 dark:text-emerald-400"
									: "text-amber-700 dark:text-amber-400",
							)}
						>
							{title}
						</p>
						<p
							className={cn(
								"font-bold text-2xl",
								isSuccess
									? "text-emerald-900 dark:text-emerald-100"
									: "text-amber-900 dark:text-amber-100",
							)}
						>
							{formattedValue}
						</p>
					</div>
					{Icon && (
						<div
							className={cn(
								"rounded-lg p-2",
								isSuccess ? "bg-emerald-100 dark:bg-emerald-900/50" : "bg-amber-100 dark:bg-amber-900/50",
							)}
						>
							<Icon
								className={cn(
									"h-4 w-4",
									isSuccess
										? "text-emerald-600 dark:text-emerald-400"
										: "text-amber-600 dark:text-amber-400",
								)}
							/>
						</div>
					)}
				</div>
				{footer && (
					<div
						className={cn(
							"mt-3 flex items-center gap-1.5 text-xs",
							isSuccess
								? "text-emerald-600/80 dark:text-emerald-400/80"
								: "text-amber-600/80 dark:text-amber-400/80",
						)}
					>
						{footer}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
