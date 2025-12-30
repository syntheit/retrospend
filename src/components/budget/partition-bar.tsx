"use client";

import { useMemo } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { CATEGORY_COLOR_MAP } from "~/lib/constants";

// Helper function to get category color with opacity for striped background
function getCategoryColorWithOpacity(color: string, opacity: number = 0.8): string {
	const _COLOR_TO_HEX: Record<string, string> = {
		emerald: "#059669",
		blue: "#2563eb",
		sky: "#0ea5e9",
		cyan: "#0891b2",
		teal: "#0d9488",
		orange: "#ea580c",
		amber: "#f59e0b",
		violet: "#7c3aed",
		pink: "#ec4899",
		fuchsia: "#c026d3",
		indigo: "#4f46e5",
		slate: "#64748b",
		zinc: "#71717a",
		lime: "#65a30d",
		neutral: "#737373",
		gray: "#6b7280",
		purple: "#9333ea",
		yellow: "#eab308",
		stone: "#78716c",
		rose: "#f43f5e",
		red: "#dc2626",
	};

	const hexColor = _COLOR_TO_HEX[color as keyof typeof _COLOR_TO_HEX] || "#6b7280";
	// Convert hex to rgba
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
	globalLimit: number;
	categoryBudgets: CategoryBudget[];
	isMobile: boolean;
	budgetMode: "GLOBAL_LIMIT" | "SUM_OF_CATEGORIES";
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

export function PartitionBar({
	globalLimit,
	categoryBudgets,
	isMobile,
	budgetMode,
}: PartitionBarProps) {
	const segments = useMemo(() => {
		const totalAllocated = categoryBudgets.reduce(
			(sum, budget) => sum + budget.allocatedAmount,
			0,
		);
		const effectiveTotal =
			budgetMode === "SUM_OF_CATEGORIES" ? totalAllocated : globalLimit;

		if (effectiveTotal === 0) return [];

		const unallocatedAmount =
			budgetMode === "GLOBAL_LIMIT"
				? Math.max(0, globalLimit - totalAllocated)
				: 0;

		// Create segments for allocated budgets
		const allocatedSegments: Segment[] = categoryBudgets.map((budget) => ({
			id: budget.id,
			name: budget.name,
			color: budget.color,
			percentage: (budget.allocatedAmount / effectiveTotal) * 100,
			value: budget.allocatedAmount,
			isMisc: false,
			isPegged: budget.pegToActual,
		}));

		// Separate small slices (< 5%) from regular segments
		const regularSegments: Segment[] = [];
		const smallSlices: Array<{ name: string; value: number }> = [];

		allocatedSegments.forEach((segment) => {
			if (segment.percentage < 5) {
				smallSlices.push({ name: segment.name, value: segment.value });
			} else {
				regularSegments.push(segment);
			}
		});

		// Create misc segment if there are small slices
		if (smallSlices.length > 0) {
			const miscValue = smallSlices.reduce((sum, item) => sum + item.value, 0);
			regularSegments.push({
				id: "misc",
				name: "Misc/Other",
				color: "gray", // Use neutral gray for misc
				percentage: (miscValue / effectiveTotal) * 100,
				value: miscValue,
				isMisc: true,
				isPegged: false,
				miscItems: smallSlices,
			});
		}

		// Add unallocated segment
		if (unallocatedAmount > 0) {
			regularSegments.push({
				id: "unallocated",
				name: "Unallocated",
				color: "stone", // Dark grey for unallocated space
				percentage: (unallocatedAmount / effectiveTotal) * 100,
				value: unallocatedAmount,
				isMisc: false,
				isPegged: false,
			});
		}

		return regularSegments;
	}, [globalLimit, categoryBudgets, budgetMode]);

	const getColorClass = (color: string) => {
		if (color === "stone") return "bg-stone-700";
		if (color === "gray") return "bg-gray-500";
		const colorMapping =
			CATEGORY_COLOR_MAP[color as keyof typeof CATEGORY_COLOR_MAP];
		if (colorMapping) {
			// Extract just the background class from the mapping
			return colorMapping.split(" ")[0];
		}
		return "bg-gray-500";
	};

	if (isMobile) {
		// Mobile: Single capacity bar
		const _totalAllocated = categoryBudgets.reduce(
			(sum, budget) => sum + budget.allocatedAmount,
			0,
		);
		const totalSpent = categoryBudgets.reduce(
			(sum, budget) => sum + budget.actualSpend,
			0,
		);
		const capacityPercentage =
			globalLimit > 0 ? (totalSpent / globalLimit) * 100 : 0;

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
	}

	// Desktop: Full partition bar
	return (
		<div className="w-full">
			<div className="relative h-12 w-full overflow-hidden rounded-lg bg-muted">
				<div className="absolute inset-0 flex">
					{segments.map((segment, index) => {
						const colorClass = getColorClass(segment.color);
						const isFirst = index === 0;
						const isLast = index === segments.length - 1;

						return (
							<Tooltip key={segment.id}>
								<TooltipTrigger asChild>
									<div
										className={`relative h-full transition-all duration-200 hover:opacity-80 cursor-pointer${isFirst ? "rounded-l-lg" : ""}
											${isLast ? "rounded-r-lg" : ""}
											${segment.isPegged ? "bg-stripes" : colorClass}
										`}
										style={{
											width: `${segment.percentage}%`,
											backgroundColor: segment.isPegged
												? getCategoryColorWithOpacity(segment.color)
												: undefined,
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
}
