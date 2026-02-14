import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { cn } from "~/lib/utils";

interface MetricCardProps {
	title: string;
	value: string | ReactNode;
	icon: ReactNode;
	subtext?: ReactNode;
	className?: string;
	headerClassName?: string;
	titleClassName?: string;
	iconClassName?: string;
	contentClassName?: string;
	overlay?: ReactNode;
}

export function MetricCard({
	title,
	value,
	icon,
	subtext,
	className,
	headerClassName,
	titleClassName,
	iconClassName,
	contentClassName,
	overlay,
}: MetricCardProps) {
	return (
		<Card
			className={cn(
				"relative flex flex-col justify-between overflow-hidden shadow-xl",
				className,
			)}
		>
			<CardHeader
				className={cn(
					"flex flex-row items-center justify-between space-y-0 pb-2",
					headerClassName,
				)}
			>
				<CardTitle
					className={cn(
						"font-medium text-sm uppercase tracking-wider",
						titleClassName,
					)}
				>
					{title}
				</CardTitle>
				<div className={cn("h-4 w-4", iconClassName)}>{icon}</div>
			</CardHeader>
			<CardContent className={cn("relative pt-2", contentClassName)}>
				{overlay}
				<div className="font-bold text-3xl tracking-tight">{value}</div>
				{subtext && <div className="mt-1">{subtext}</div>}
			</CardContent>
		</Card>
	);
}
