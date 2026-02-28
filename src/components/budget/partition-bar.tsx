"use client";

import { useMemo } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
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

const DesktopPartitionBar = ({ segments }: { segments: Segment[] }) => {
	const { formatCurrency } = useCurrencyFormatter();
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
								<TooltipContent className="grid min-w-[8rem] items-start gap-1.5 rounded-lg border bg-popover px-2.5 py-1.5 text-popover-foreground text-xs antialiased shadow-md backdrop-blur-md will-change-transform [backface-visibility:hidden] [transform:translateZ(0)]">
									<div className="grid gap-1.5">
										<div className="font-medium">{segment.name}</div>
										<div className="mt-1 grid gap-1.5">
											{segment.isMisc && segment.miscItems ? (
												segment.miscItems.map((item) => (
													<div
														className="flex w-full items-stretch gap-2"
														key={item.name}
													>
														<div
															className="my-0.5 w-1 shrink-0 rounded-[2px]"
															style={{
																backgroundColor:
																	colorStyle.backgroundColor ||
																	getCategoryColorWithOpacity(segment.color, 1),
															}}
														/>
														<div className="flex flex-1 items-center justify-between gap-4 leading-none">
															<span className="text-muted-foreground">
																{item.name}
															</span>
															<span className="font-semibold text-foreground tabular-nums">
																{formatCurrency(item.value, "USD")}
															</span>
														</div>
													</div>
												))
											) : (
												<div className="flex w-full items-stretch gap-2">
													<div
														className="my-0.5 w-1 shrink-0 rounded-[2px]"
														style={{
															backgroundColor:
																colorStyle.backgroundColor ||
																getCategoryColorWithOpacity(segment.color, 1),
														}}
													/>
													<div className="flex flex-1 items-center justify-between gap-4 leading-none">
														<span className="text-muted-foreground">
															{Number(segment.percentage).toFixed(1)}%
														</span>
														<span className="font-semibold text-foreground tabular-nums">
															{formatCurrency(segment.value, "USD")}
														</span>
													</div>
												</div>
											)}
										</div>
									</div>
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
}: {
	categoryBudgets: CategoryBudget[];
	isMobile?: boolean;
}) {
	const { segments } = useMemo(() => {
		const totalAllocated = categoryBudgets.reduce(
			(sum, budget) => sum + budget.allocatedAmount,
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
				const miscValue = smallSlices.reduce(
					(sum, item) => sum + item.value,
					0,
				);
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

		return {
			segments: calculatedSegments,
		};
	}, [categoryBudgets]);

	return (
		<div className="w-full">
			<DesktopPartitionBar segments={segments} />
		</div>
	);
}
