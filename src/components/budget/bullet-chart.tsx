"use client";

import { COLOR_TO_HEX } from "~/lib/constants";

interface BulletChartProps {
	actualSpend: number;
	budgetAmount: number;
	color: string;
	isOverBudget?: boolean;
	isPegged?: boolean;
}

// Helper function to interpolate between two colors
function interpolateColor(
	color1: string,
	color2: string,
	factor: number,
): string {
	const hex1 = color1.replace("#", "");
	const hex2 = color2.replace("#", "");

	const r1 = parseInt(hex1.substr(0, 2), 16);
	const g1 = parseInt(hex1.substr(2, 2), 16);
	const b1 = parseInt(hex1.substr(4, 2), 16);

	const r2 = parseInt(hex2.substr(0, 2), 16);
	const g2 = parseInt(hex2.substr(2, 2), 16);
	const b2 = parseInt(hex2.substr(4, 2), 16);

	const r = Math.round(r1 + (r2 - r1) * factor);
	const g = Math.round(g1 + (g2 - g1) * factor);
	const b = Math.round(b1 + (b2 - b1) * factor);

	return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// Get progress color based on percentage and peg status
function getProgressColor(percentage: number, isPegged: boolean): string {
	if (isPegged) {
		// For pegged budgets, use neutral gray tones instead of warning colors
		if (percentage >= 1) return "#6b7280";
		if (percentage >= 0.75) return "#9ca3af";
		if (percentage >= 0.5) return "#d1d5db";
		return "#e5e7eb";
	}

	// Standard warning colors for fixed budgets
	if (percentage >= 1) return "#dc2626";
	if (percentage >= 0.9)
		return interpolateColor("#ea580c", "#dc2626", (percentage - 0.9) / 0.1);
	if (percentage >= 0.75)
		return interpolateColor("#f59e0b", "#ea580c", (percentage - 0.75) / 0.15);
	if (percentage >= 0.5)
		return interpolateColor("#10b981", "#f59e0b", (percentage - 0.5) / 0.25);
	return "#10b981";
}

// Get category color with opacity for striped background
function getCategoryColorWithOpacity(
	color: string,
	opacity: number = 0.8,
): string {
	const hexColor =
		COLOR_TO_HEX[color as keyof typeof COLOR_TO_HEX] || "#6b7280";
	const r = parseInt(hexColor.slice(1, 3), 16);
	const g = parseInt(hexColor.slice(3, 5), 16);
	const b = parseInt(hexColor.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function BulletChart({
	actualSpend,
	budgetAmount,
	color,
	isOverBudget: propIsOverBudget,
	isPegged,
}: BulletChartProps) {
	if (budgetAmount <= 0) {
		return (
			<div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
				<div
					className={`absolute inset-0 rounded-full ${isPegged ? "bg-stripes" : "bg-stone-300 dark:bg-stone-600"}`}
					style={
						isPegged
							? {
									backgroundColor: getCategoryColorWithOpacity(color),
								}
							: undefined
					}
				/>
			</div>
		);
	}

	const spendPercentage = actualSpend / budgetAmount;
	const _effectiveIsOverBudget = propIsOverBudget ?? spendPercentage > 1;
	const displayPercentage = Math.min(spendPercentage, 1);

	const progressColor = getProgressColor(spendPercentage, isPegged || false);

	return (
		<div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
			<div
				className={`absolute inset-0 rounded-full ${isPegged ? "bg-stripes" : "bg-stone-300 dark:bg-stone-600"}`}
				style={
					isPegged
						? {
								backgroundColor: getCategoryColorWithOpacity(color),
							}
						: undefined
				}
			/>

			<div
				className={`absolute top-0 left-0 h-full rounded-full transition-all duration-300 ${isPegged ? "bg-stripes" : ""}`}
				style={{
					width: `${displayPercentage * 100}%`,
					backgroundColor: isPegged
						? getCategoryColorWithOpacity(color)
						: progressColor,
				}}
			/>
		</div>
	);
}
