import type { SeriesPoint } from "./source";

// Which points of the server's daily series a range shows. The chart itself
// (ui/charts/AreaChart) places them; the figures stay the server's.

export const RANGES = ["1M", "3M", "6M", "1Y", "All"] as const;
export type WealthRange = (typeof RANGES)[number];

/** The headline says "in 30 days", so the chart opens on the same month. */
export const DEFAULT_RANGE: WealthRange = "1M";

const DAYS: Record<Exclude<WealthRange, "All">, number> = {
	"1M": 30,
	"3M": 90,
	"6M": 180,
	"1Y": 365,
};

/**
 * The last `days + 1` points (today and the days before it) of the series;
 * All is every point the server sent (it caps the series at a year).
 */
export function sliceRange(
	series: readonly SeriesPoint[],
	range: WealthRange,
): SeriesPoint[] {
	if (range === "All") return [...series];
	return series.slice(-(DAYS[range] + 1));
}

/** Days read as "Oct 21" up to six months, as "Oct" beyond. */
export function datesFor(range: WealthRange): "day" | "month" {
	return range === "1Y" || range === "All" ? "month" : "day";
}
