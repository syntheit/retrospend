"use client";

import { useMemo } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import {
	CATEGORY_COLOR_MAP,
	COLOR_TO_HEX,
	VIBRANT_CATEGORY_COLORS,
} from "~/lib/constants";
import { cn } from "~/lib/utils";


// Helper function to get category color with opacity for striped background
function getCategoryColorWithOpacity(
	color: string,
	opacity: number = 0.8,
): string {
	const colorValue =
		VIBRANT_CATEGORY_COLORS[color] || COLOR_TO_HEX[color] || "#6b7280";

	if (colorValue.startsWith("hsl")) {
		return colorValue.replace("hsl(", "hsla(").replace(")", `, ${opacity})`);
	}

	// Fallback for hex colors
	const hexColor = colorValue;
	const r = parseInt(hexColor.slice(1, 3), 16);
	const g = parseInt(hexColor.slice(3, 5), 16);
	const b = parseInt(hexColor.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

interface CategoryBudget {
	id: string;
	name: string;
	color: string;
	allocatedAmount: number;
	actualSpend: number;
	pegToActual: boolean;
}

interface PartitionBarProps {
	categoryBudgets: CategoryBudget[];
	isMobile: boolean;
}

interface Segment {
	id: string;
	name: string;
	color: string;
	percentage: number;
	value: number;
	isMisc: boolean;
	isPegged: boolean;
	miscItems?: Array<{ name: string; value: number }>;
}

const MobilePartitionBar = ({
	capacityPercentage,
}: { capacityPercentage: number }) => {
	return (
		<div className="w-full">
			<div className="relative h-12 w-full overflow-hidden rounded-lg bg-muted">
				<div
					className="absolute top-0 left-0 h-full bg-primary transition-all duration-300"
					style={{ width: `${Math.min(capacityPercentage, 100)}%` }}
				/>
				{capacityPercentage > 100 && (
					<div
						className="absolute top-0 left-0 h-full bg-destructive transition-all duration-300"
						style={{
							width: `${Math.min(capacityPercentage - 100, 100)}%`,
							marginLeft: "100%",
						}}
					/>
				)}
				<div className="absolute inset-0 flex items-center justify-center">
					<span className="font-medium text-foreground text-sm">
						{Math.round(capacityPercentage)}% Capacity Used
					</span>
				</div>
			</div>
		</div>
	);
};

const DesktopPartitionBar = ({ segments }: { segments: Segment[] }) => {
	const getColorStyle = (color: string) => {
		if (color === "stone") return { backgroundColor: "#444" };
		if (color === "gray") return { backgroundColor: "#6b7280" };

		const colorValue = VIBRANT_CATEGORY_COLORS[color];
		if (colorValue) return { backgroundColor: colorValue };

		const colorMapping =
			CATEGORY_COLOR_MAP[color as keyof typeof CATEGORY_COLOR_MAP];
		if (colorMapping) {
			return {};
		}
		return { backgroundColor: "#6b7280" };
	};

	return (
		<div className="w-full">
			<div className="relative h-12 w-full overflow-hidden rounded-lg bg-muted">
				<div className="absolute inset-0 flex">
					{segments.map((segment, index) => {
						const colorStyle = getColorStyle(segment.color);
						const isFirst = index === 0;
						const isLast = index === segments.length - 1;

						return (
							<Tooltip key={segment.id}>
								<TooltipTrigger asChild>
									<div
										className={cn(
											"relative h-full cursor-pointer transition-all duration-200 hover:opacity-80",
											isFirst && "rounded-l-lg",
											isLast && "rounded-r-lg",
										)}
										style={{
											width: `${segment.percentage}%`,
											...(!segment.isPegged ? colorStyle : {}),
											backgroundColor: segment.isPegged
												? getCategoryColorWithOpacity(segment.color)
												: colorStyle.backgroundColor,
											backgroundImage: segment.isPegged
												? "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.1) 4px, rgba(255,255,255,0.1) 8px)"
												: undefined,
										}}
									/>
								</TooltipTrigger>
								<TooltipContent>
									{segment.isMisc && segment.miscItems ? (
										<div>
											<div className="font-medium">{segment.name}</div>
											<div className="mt-1 text-muted-foreground text-sm">
												{segment.miscItems.map((item) => (
													<div key={item.name}>
														{item.name}: ${Number(item.value).toFixed(2)}
													</div>
												))}
											</div>
										</div>
									) : (
										<div>
											<div className="font-medium">{segment.name}</div>
											<div className="text-muted-foreground text-sm">
												${Number(segment.value).toFixed(2)} (
												{Number(segment.percentage).toFixed(1)}%)
											</div>
										</div>
									)}
								</TooltipContent>
							</Tooltip>
						);
					})}
				</div>
			</div>
		</div>
	);
};

export function PartitionBar({
	categoryBudgets,
}: Omit<PartitionBarProps, "isMobile"> & { isMobile?: boolean }) {
	const { segments, capacityPercentage } = useMemo(() => {
		const totalAllocated = categoryBudgets.reduce(
			(sum, budget) => sum + budget.allocatedAmount,
			0,
		);
		const totalSpent = categoryBudgets.reduce(
			(sum, budget) => sum + budget.actualSpend,
			0,
		);

		const effectiveTotal = totalAllocated;

		// Desktop Segments logic
		let calculatedSegments: Segment[] = [];
		if (effectiveTotal > 0) {
			const allocatedSegments: Segment[] = categoryBudgets.map((budget) => ({
				id: budget.id,
				name: budget.name,
				color: budget.color,
				percentage: (budget.allocatedAmount / effectiveTotal) * 100,
				value: budget.allocatedAmount,
				isMisc: false,
				isPegged: budget.pegToActual,
			}));

			const regularSegments: Segment[] = [];
			const smallSlices: Array<{ name: string; value: number }> = [];

			allocatedSegments.forEach((segment) => {
				if (segment.percentage < 5) {
					smallSlices.push({ name: segment.name, value: segment.value });
				} else {
					regularSegments.push(segment);
				}
			});

			if (smallSlices.length > 0) {
				const miscValue = smallSlices.reduce((sum, item) => sum + item.value, 0);
				regularSegments.push({
					id: "misc",
					name: "Misc/Other",
					color: "gray",
					percentage: (miscValue / effectiveTotal) * 100,
					value: miscValue,
					isMisc: true,
					isPegged: false,
					miscItems: smallSlices,
				});
			}
			calculatedSegments = regularSegments;
		}

		// Mobile Capacity logic
		const calculatedCapacityPercentage =
			effectiveTotal > 0 ? (totalSpent / effectiveTotal) * 100 : 0;

		return {
			segments: calculatedSegments,
			capacityPercentage: calculatedCapacityPercentage,
		};
	}, [categoryBudgets]);

	return (
		<div className="w-full">
			<div className="md:hidden">
				<MobilePartitionBar capacityPercentage={capacityPercentage} />
			</div>
			<div className="hidden md:block">
				<DesktopPartitionBar segments={segments} />
			</div>
		</div>
	);
}
