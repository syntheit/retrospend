"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import * as React from "react";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

const statCardVariants = cva(
	"group relative overflow-hidden transition-all duration-300",
	{
		variants: {
			variant: {
				neutral:
					"border-0 bg-gradient-to-br from-stone-800 via-stone-700 to-stone-900 text-white shadow-lg hover:shadow-xl dark:from-stone-900 dark:via-stone-800 dark:to-black",
				blue: "border-blue-200/50 bg-gradient-to-br from-blue-50 to-white hover:shadow-lg hover:shadow-blue-100 dark:border-blue-900/50 dark:from-blue-950/30 dark:to-card",
				cyan: "border-cyan-200/50 bg-gradient-to-br from-cyan-50 to-white hover:shadow-lg hover:shadow-cyan-100 dark:border-cyan-900/50 dark:from-cyan-950/30 dark:to-card",
				violet:
					"border-violet-200/50 bg-gradient-to-br from-violet-50 to-white hover:shadow-lg hover:shadow-violet-100 dark:border-violet-900/50 dark:from-violet-950/30 dark:to-card",
				amber: "border-amber-200/50 bg-gradient-to-br from-amber-50 to-white hover:shadow-lg hover:shadow-amber-100 dark:border-amber-900/50 dark:from-amber-950/30 dark:to-card",
				indigo:
					"border-indigo-200/50 bg-gradient-to-br from-indigo-50 to-white hover:shadow-lg hover:shadow-indigo-100 dark:border-indigo-900/50 dark:from-indigo-950/30 dark:to-card",
				rose: "border-rose-200/50 bg-gradient-to-br from-rose-50 to-white hover:shadow-lg hover:shadow-rose-100 dark:border-rose-900/50 dark:from-rose-950/30 dark:to-card",
				emerald:
					"border-emerald-200/50 bg-gradient-to-br from-emerald-50 to-white hover:shadow-lg hover:shadow-emerald-100 dark:border-emerald-900/50 dark:from-emerald-950/30 dark:to-card",
			},
		},
		defaultVariants: {
			variant: "blue",
		},
	},
);

const circleVariants = cva(
	"absolute top-0 right-0 h-20 w-20 translate-x-8 -translate-y-8 rounded-full transition-transform duration-300 group-hover:scale-150",
	{
		variants: {
			variant: {
				neutral: "bg-white/10",
				blue: "bg-blue-500/10",
				cyan: "bg-cyan-500/10",
				violet: "bg-violet-500/10",
				amber: "bg-amber-500/10",
				indigo: "bg-indigo-500/10",
				rose: "bg-rose-500/10",
				emerald: "bg-emerald-500/10",
			},
		},
		defaultVariants: {
			variant: "blue",
		},
	},
);

const titleVariants = cva("font-medium text-sm", {
	variants: {
		variant: {
			neutral: "text-stone-300",
			blue: "text-blue-700 dark:text-blue-400",
			cyan: "text-cyan-700 dark:text-cyan-400",
			violet: "text-violet-700 dark:text-violet-400",
			amber: "text-amber-700 dark:text-amber-400",
			indigo: "text-indigo-700 dark:text-indigo-400",
			rose: "text-rose-700 dark:text-rose-400",
			emerald: "text-emerald-700 dark:text-emerald-400",
		},
	},
	defaultVariants: {
		variant: "blue",
	},
});

const valueVariants = cva("font-bold text-2xl tracking-tight", {
	variants: {
		variant: {
			neutral: "text-white",
			blue: "text-blue-900 dark:text-blue-100",
			cyan: "text-cyan-900 dark:text-cyan-100",
			violet: "text-violet-900 dark:text-violet-100",
			amber: "text-amber-900 dark:text-amber-100",
			indigo: "text-indigo-900 dark:text-indigo-100",
			rose: "text-rose-900 dark:text-rose-100",
			emerald: "text-emerald-900 dark:text-emerald-100",
		},
	},
	defaultVariants: {
		variant: "blue",
	},
});

const iconContainerVariants = cva("rounded-lg p-2.5", {
	variants: {
		variant: {
			neutral: "bg-white/10",
			blue: "bg-blue-100 dark:bg-blue-900/50",
			cyan: "bg-cyan-100 dark:bg-cyan-900/50",
			violet: "bg-violet-100 dark:bg-violet-900/50",
			amber: "bg-amber-100 dark:bg-amber-900/50",
			indigo: "bg-indigo-100 dark:bg-indigo-900/50",
			rose: "bg-rose-100 dark:bg-rose-900/50",
			emerald: "bg-emerald-100 dark:bg-emerald-900/50",
		},
	},
	defaultVariants: {
		variant: "blue",
	},
});

const iconVariants = cva("h-5 w-5", {
	variants: {
		variant: {
			neutral: "text-stone-300",
			blue: "text-blue-600 dark:text-blue-400",
			cyan: "text-cyan-600 dark:text-cyan-400",
			violet: "text-violet-600 dark:text-violet-400",
			amber: "text-amber-600 dark:text-amber-400",
			indigo: "text-indigo-600 dark:text-indigo-400",
			rose: "text-rose-600 dark:text-rose-400",
			emerald: "text-emerald-600 dark:text-emerald-400",
		},
	},
	defaultVariants: {
		variant: "blue",
	},
});

const footerVariants = cva("mt-2 flex flex-col gap-1", {
	variants: {
		variant: {
			neutral: "text-stone-400",
			blue: "text-blue-600/80 dark:text-blue-400/80",
			cyan: "text-cyan-600/80 dark:text-cyan-400/80",
			violet: "text-violet-600/80 dark:text-violet-400/80",
			amber: "text-amber-600/80 dark:text-amber-400/80",
			indigo: "text-indigo-600/80 dark:text-indigo-400/80",
			rose: "text-rose-600/80 dark:text-rose-400/80",
			emerald: "text-emerald-600/80 dark:text-emerald-400/80",
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
	formatCurrency?: (value: number) => string;
	className?: string;
}

export function StatCard({
	title,
	value,
	icon: Icon,
	variant = "blue",
	description,
	loading = false,
	trend,
	formatCurrency,
	className,
}: StatCardProps) {
	return (
		<Card className={cn(statCardVariants({ variant }), className)}>
			{/* Decorative Circle */}
			<div className={circleVariants({ variant })} />

			<CardContent className="relative p-4">
				<div className="flex items-start justify-between">
					<div className="space-y-1">
						<p className={titleVariants({ variant })}>{title}</p>
						{loading ? (
							<Skeleton
								className={cn("h-8 w-28", variant === "neutral" && "bg-white/10")}
							/>
						) : (
							<p className={valueVariants({ variant })}>{value}</p>
						)}
					</div>
					<div className={iconContainerVariants({ variant })}>
						<Icon className={iconVariants({ variant })} />
					</div>
				</div>

				{/* Footer Content: Trend or Description */}
				{!loading && (
					<div className={footerVariants({ variant })}>
						{trend && trend.value !== null && trend.value !== undefined && (
							<div className="flex items-center gap-1.5 text-sm">
								<div
									className={cn(
										"flex items-center gap-1 font-medium",
										trend.forceNeutral
											? "text-inherit"
											: trend.intent === "negative"
												? "text-red-300"
												: "text-emerald-300",
									)}
								>
									{trend.value > 0 ? (
										<TrendingUp className="h-3.5 w-3.5" />
									) : (
										<TrendingDown className="h-3.5 w-3.5" />
									)}
									{trend.value > 0 ? "+" : ""}
									{trend.isMoney && formatCurrency
										? formatCurrency(trend.value)
										: `${trend.value.toFixed(1)}%`}
								</div>
								<span>{trend.label}</span>
							</div>
						)}
						{description && <div className="text-sm">{description}</div>}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
