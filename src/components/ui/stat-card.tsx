"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { type LucideIcon, TrendingDown, TrendingUp } from "lucide-react";
import type * as React from "react";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

const statCardVariants = cva(
	"group relative h-32 overflow-hidden border border-border bg-card transition-all duration-300 hover:bg-accent/5",
	{
		variants: {
			variant: {
				neutral: "text-foreground shadow-sm",
				blue: "text-foreground shadow-[inset_0_0_20px_rgba(59,130,246,0.05)]",
				cyan: "text-foreground shadow-[inset_0_0_20px_rgba(6,182,212,0.05)]",
				violet: "text-foreground shadow-[inset_0_0_20px_rgba(139,92,246,0.05)]",
				amber: "text-foreground shadow-[inset_0_0_20px_rgba(245,158,11,0.05)]",
				indigo: "text-foreground shadow-[inset_0_0_20px_rgba(99,102,241,0.05)]",
				rose: "text-foreground shadow-[inset_0_0_20px_rgba(244,63,94,0.05)]",
				emerald:
					"text-foreground shadow-[inset_0_0_20px_rgba(16,185,129,0.05)]",
			},
		},
		defaultVariants: {
			variant: "blue",
		},
	},
);

const spotlightVariants = cva(
	"pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full blur-3xl transition-opacity duration-500",
	{
		variants: {
			variant: {
				neutral: "bg-muted-foreground/10",
				blue: "bg-blue-500/20 dark:bg-blue-500/30",
				cyan: "bg-cyan-500/20 dark:bg-cyan-500/30",
				violet: "bg-violet-500/20 dark:bg-violet-500/30",
				amber: "bg-amber-500/20 dark:bg-amber-500/30",
				indigo: "bg-indigo-500/20 dark:bg-indigo-500/30",
				rose: "bg-rose-500/20 dark:bg-rose-500/30",
				emerald: "bg-emerald-500/20 dark:bg-emerald-500/30",
			},
		},
		defaultVariants: {
			variant: "blue",
		},
	},
);

const iconColorVariants = cva("", {
	variants: {
		variant: {
			neutral: "text-muted-foreground",
			blue: "text-blue-600 dark:text-blue-400",
			cyan: "text-cyan-600 dark:text-cyan-400",
			violet: "text-violet-600 dark:text-violet-400",
			amber: "text-amber-600 dark:text-amber-400",
			indigo: "text-indigo-600 dark:text-indigo-400",
			rose: "text-rose-600 dark:text-rose-400",
			emerald: "text-emerald-500",
		},
	},
	defaultVariants: {
		variant: "blue",
	},
});

export interface StatCardProps extends VariantProps<typeof statCardVariants> {
	title: string;
	value?: React.ReactNode;
	icon: LucideIcon;
	description?: React.ReactNode;
	loading?: boolean;
	trend?: {
		value: number | null;
		label: string;
		isMoney?: boolean;
		intent?: "positive" | "negative";
		forceNeutral?: boolean;
	};
	subValue?: React.ReactNode;
	formatCurrency?: (value: number) => string;
	className?: string;
}

export function StatCard({
	title,
	value,
	subValue,
	icon: Icon,
	variant = "blue",
	description,
	loading = false,
	trend,
	formatCurrency,
	className,
}: StatCardProps) {
	const iconColor = iconColorVariants({ variant });

	return (
		<Card className={cn(statCardVariants({ variant }), className, "p-0")}>
			{/* Spotlight Gradient */}
			<div className={spotlightVariants({ variant })} />

			<CardContent className="relative z-10 flex h-full flex-col justify-between p-5">
				{/* Top Row: Title + Icon */}
				<div className="flex w-full items-start justify-between">
					<span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-widest">
						{title}
					</span>
					<Icon className={cn("h-4 w-4", iconColor)} />
				</div>

				{/* Bottom Row: Value + Trend/Desc */}
				<div className="flex w-full items-end justify-between">
					<div className="flex flex-col gap-0.5">
						<div className="font-bold text-2xl text-foreground tabular-nums tracking-tight">
							{loading ? <Skeleton className="h-8 w-24 bg-muted" /> : value}
						</div>
						{!loading && subValue && (
							<div className="flex items-center gap-1 font-medium text-[10px] text-muted-foreground">
								{subValue}
							</div>
						)}
					</div>

					{!loading && (description || (trend && trend.value !== null)) && (
						<div className="flex items-center text-xs">
							{trend && trend.value !== null && trend.value !== undefined ? (
								<div
									className={cn(
										"flex items-center gap-1.5 rounded-full px-2 py-1 font-medium",
										trend.forceNeutral
											? "bg-muted text-muted-foreground"
											: trend.intent === "negative"
												? "bg-destructive/10 text-destructive dark:text-rose-400"
												: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
									)}
								>
									{trend.value > 0 ? (
										<TrendingUp className="h-3 w-3" />
									) : (
										<TrendingDown className="h-3 w-3" />
									)}
									<span className="tabular-nums">
										{trend.value > 0 ? "+" : ""}
										{trend.isMoney && formatCurrency
											? formatCurrency(trend.value)
											: `${trend.value.toFixed(1)}%`}
									</span>
									<span className="ml-1 hidden opacity-70 xl:inline">
										{trend.label.replace("vs ", "")}
									</span>
								</div>
							) : (
								<span className="max-w-[100px] truncate text-right text-[10px] leading-tight opacity-50">
									{description}
								</span>
							)}
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
