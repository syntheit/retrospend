"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { type LucideIcon, TrendingDown, TrendingUp } from "lucide-react";
import type * as React from "react";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

const statCardVariants = cva(
	"group relative h-32 overflow-hidden border transition-all duration-300",
	{
		variants: {
			variant: {
				neutral:
					"border-white/10 bg-stone-900/40 text-white shadow-inner hover:bg-stone-900/60",
				blue: "border-blue-500/20 bg-blue-950/20 text-blue-100 shadow-[inset_0_0_20px_rgba(59,130,246,0.05)] hover:border-blue-500/30 hover:bg-blue-900/30",
				cyan: "border-cyan-500/20 bg-cyan-950/20 text-cyan-100 shadow-[inset_0_0_20px_rgba(6,182,212,0.05)] hover:border-cyan-500/30 hover:bg-cyan-900/30",
				violet:
					"border-violet-500/20 bg-violet-950/20 text-violet-100 shadow-[inset_0_0_20px_rgba(139,92,246,0.05)] hover:border-violet-500/30 hover:bg-violet-900/30",
				amber:
					"border-amber-500/20 bg-amber-950/20 text-amber-100 shadow-[inset_0_0_20px_rgba(245,158,11,0.05)] hover:border-amber-500/30 hover:bg-amber-900/30",
				indigo:
					"border-indigo-500/20 bg-indigo-950/20 text-indigo-100 shadow-[inset_0_0_20px_rgba(99,102,241,0.05)] hover:border-indigo-500/30 hover:bg-indigo-900/30",
				rose: "border-rose-500/20 bg-rose-950/20 text-rose-100 shadow-[inset_0_0_20px_rgba(244,63,94,0.05)] hover:border-rose-500/30 hover:bg-rose-900/30",
				emerald:
					"border-emerald-500/20 bg-emerald-950/30 text-emerald-100 shadow-[inset_0_0_20px_rgba(16,185,129,0.05)] hover:border-emerald-500/30 hover:bg-emerald-900/30",
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
				neutral: "bg-white/5",
				blue: "bg-blue-500/20",
				cyan: "bg-cyan-500/20",
				violet: "bg-violet-500/20",
				amber: "bg-amber-500/20",
				indigo: "bg-indigo-500/20",
				rose: "bg-rose-500/20",
				emerald: "bg-emerald-500/20",
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
			neutral: "text-stone-400",
			blue: "text-blue-400",
			cyan: "text-cyan-400",
			violet: "text-violet-400",
			amber: "text-amber-400",
			indigo: "text-indigo-400",
			rose: "text-rose-400",
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
					<div className="font-bold text-3xl text-white tracking-tight">
						{loading ? <Skeleton className="h-8 w-24 bg-white/10" /> : value}
					</div>

					{!loading && (description || (trend && trend.value !== null)) && (
						<div className="flex items-center text-xs">
							{trend && trend.value !== null && trend.value !== undefined ? (
								<div
									className={cn(
										"flex items-center gap-1.5 rounded-full px-2 py-1 font-medium",
										trend.forceNeutral
											? "bg-white/5 text-stone-300"
											: trend.intent === "negative"
												? "bg-rose-500/10 text-rose-400"
												: "bg-emerald-500/10 text-emerald-400",
									)}
								>
									{trend.value > 0 ? (
										<TrendingUp className="h-3 w-3" />
									) : (
										<TrendingDown className="h-3 w-3" />
									)}
									<span>
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
