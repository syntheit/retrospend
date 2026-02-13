"use client";

import React from "react";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const statCardVariants = cva(
	"group relative overflow-hidden transition-all duration-300",
	{
		variants: {
			variant: {
				blue: "border-blue-200/50 bg-gradient-to-br from-blue-50 to-white hover:shadow-lg hover:shadow-blue-100 dark:border-blue-900/50 dark:from-blue-950/30 dark:to-card",
				violet: "border-violet-200/50 bg-gradient-to-br from-violet-50 to-white hover:shadow-lg hover:shadow-violet-100 dark:border-violet-900/50 dark:from-violet-950/30 dark:to-card",
				amber: "border-amber-200/50 bg-gradient-to-br from-amber-50 to-white hover:shadow-lg hover:shadow-amber-100 dark:border-amber-900/50 dark:from-amber-950/30 dark:to-card",
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
				blue: "bg-blue-500/10",
				violet: "bg-violet-500/10",
				amber: "bg-amber-500/10",
			},
		},
		defaultVariants: {
			variant: "blue",
		},
	},
);

const iconWrapperVariants = cva("rounded-lg p-2.5", {
	variants: {
		variant: {
			blue: "bg-blue-100 dark:bg-blue-900/50",
			violet: "bg-violet-100 dark:bg-violet-900/50",
			amber: "bg-amber-100 dark:bg-amber-900/50",
		},
	},
	defaultVariants: {
		variant: "blue",
	},
});

const iconVariants = cva("h-5 w-5", {
	variants: {
		variant: {
			blue: "text-blue-600 dark:text-blue-400",
			violet: "text-violet-600 dark:text-violet-400",
			amber: "text-amber-600 dark:text-amber-400",
		},
	},
	defaultVariants: {
		variant: "blue",
	},
});

const valueVariants = cva("font-bold text-4xl tracking-tight", {
	variants: {
		variant: {
			blue: "text-blue-900 dark:text-blue-100",
			violet: "text-violet-900 dark:text-violet-100",
			amber: "text-amber-900 dark:text-amber-100",
		},
	},
	defaultVariants: {
		variant: "blue",
	},
});

const descriptionVariants = cva("mt-2 text-sm", {
	variants: {
		variant: {
			blue: "text-blue-600/80 dark:text-blue-400/80",
			violet: "text-violet-600/80 dark:text-violet-400/80",
			amber: "text-amber-600/80 dark:text-amber-400/80",
		},
	},
	defaultVariants: {
		variant: "blue",
	},
});

interface StatCardProps extends VariantProps<typeof statCardVariants> {
	title: string;
	value?: React.ReactNode;
	subValue?: React.ReactNode;
	description?: React.ReactNode;
	icon: React.ElementType;
	loading?: boolean;
	className?: string;
}

export function StatCard({
	title,
	value,
	subValue,
	description,
	icon: Icon,
	variant,
	loading,
	className,
}: StatCardProps) {
	return (
		<Card className={cn(statCardVariants({ variant }), className)}>
			{/* Decorative Circle */}
			<div className={circleVariants({ variant })} />

			<CardContent className="relative p-4">
				<div className="flex items-start justify-between">
					<div className="space-y-1">
						<p className="uppercase text-xs font-bold tracking-wider text-muted-foreground">
							{title}
						</p>
						{loading ? (
							<Skeleton className="h-10 w-32" />
						) : (
							<div className="flex items-baseline gap-2">
								<p className={valueVariants({ variant })}>{value}</p>
								{subValue && (
									<p className="text-sm text-muted-foreground">{subValue}</p>
								)}
							</div>
						)}
					</div>
					<div className={iconWrapperVariants({ variant })}>
						<Icon className={iconVariants({ variant })} />
					</div>
				</div>

				{!loading && description && (
					<div className={descriptionVariants({ variant })}>{description}</div>
				)}
			</CardContent>
		</Card>
	);
}
