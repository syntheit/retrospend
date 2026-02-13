/**
 * Centralized Chart Theme Configuration
 * Uses CSS variables defined in globals.css to ensure light/dark mode harmony.
 */

export const CHART_PALETTE = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
	"var(--chart-5)",
];

export const VIBRANT_BLUE = "hsl(217, 91%, 60%)";

/**
 * Returns a consistent color for a given category name or fallback to a palette color.
 * If a specific category color is provided by the backend (as a key), it should be resolved separately, 
 * but this serves as the fallback/default logic.
 */
export function getCategoryColor(index: number): string {
	return CHART_PALETTE[index % CHART_PALETTE.length] ?? CHART_PALETTE[0] ?? "hsl(var(--muted))";
}

/**
 * Common chart constants to be used across the application.
 */
export const CHART_CONFIG_DEFAULTS = {
	cumulativeSpend: {
		label: "Cumulative spend",
		color: VIBRANT_BLUE,
	},
};
