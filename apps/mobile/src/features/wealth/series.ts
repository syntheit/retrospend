import type { Money } from "@retrospend/domain/money-minor";
import type { SeriesPoint } from "./source";

// The chart's data, as plain functions: which points a range shows, how many
// columns a width can draw, how tall each is, and which point a finger is on.
// Heights are drawing, not money: the figures stay the server's.

export const RANGES = ["1M", "3M", "6M", "1Y"] as const;
export type WealthRange = (typeof RANGES)[number];

const DAYS: Record<WealthRange, number> = {
	"1M": 30,
	"3M": 90,
	"6M": 180,
	"1Y": 365,
};

/** The last `days + 1` points (today and the days before it) of the series. */
export function sliceRange(
	series: readonly SeriesPoint[],
	range: WealthRange,
): SeriesPoint[] {
	return series.slice(-(DAYS[range] + 1));
}

/**
 * At most `max` columns: each keeps the last point of its stretch of days,
 * so the right edge is always today and a scrub lands on a real day.
 */
export function downsample(
	points: readonly SeriesPoint[],
	max: number,
): SeriesPoint[] {
	if (points.length <= max) return [...points];
	const step = points.length / max;
	const out: SeriesPoint[] = [];
	for (let i = 1; i <= max; i++) {
		const point = points[Math.min(points.length - 1, Math.ceil(i * step) - 1)];
		if (point) out.push(point);
	}
	return out;
}

/** The column index under a horizontal position, clamped to the chart. */
export function indexAt(x: number, width: number, count: number): number {
	if (count <= 0 || width <= 0) return 0;
	const index = Math.floor((x / width) * count);
	return Math.max(0, Math.min(count - 1, index));
}

/**
 * Column heights in pixels. Money in one currency is scaled between the
 * series' own lowest and highest value, with a floor so the lowest day is
 * still a visible stub; a day with no value (a missing rate) is null, a gap.
 */
export function columnHeights(
	values: readonly (Money | null)[],
	height: number,
	floor: number,
): (number | null)[] {
	const minors = values.flatMap((v) => (v ? [v.minor] : []));
	if (minors.length === 0) return values.map(() => null);
	const low = Math.min(...minors);
	const high = Math.max(...minors);
	const span = high - low;
	return values.map((v) => {
		if (!v) return null;
		if (span === 0) return height / 2;
		return floor + ((v.minor - low) / span) * (height - floor);
	});
}

/** The first and last days that have a value, for the chart's spoken summary. */
export function endsOf(points: readonly SeriesPoint[]): {
	first: SeriesPoint | null;
	last: SeriesPoint | null;
} {
	const known = points.filter((p) => p.value !== null);
	return { first: known[0] ?? null, last: known[known.length - 1] ?? null };
}
