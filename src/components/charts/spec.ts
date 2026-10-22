/**
 * The one chart spec (GUIDELINE §9). Every chart kind reads its colors,
 * strokes, margins, type and motion from here, so web charts stay one system
 * and the native apps can draw the same kinds from the same numbers.
 *
 * Colors are token references only: a single series is the accent, several
 * take series-1 to series-8 in order, categories only in category charts,
 * attention only for over budget. Labels are 12px fg-3. Gaps are null.
 */

/** Token colors as CSS references; recharts takes them as fill and stroke. */
export const COLOR = {
	accent: "var(--ds-accent)",
	/** The other bars of a highlight chart: accent mixed into the page. */
	accentDim: "color-mix(in oklab, var(--ds-accent) 30%, var(--bg))",
	area: "color-mix(in oklab, var(--ds-accent) 16%, transparent)",
	/** Last period, the comparison line. */
	previous: "var(--fg-3)",
	axis: "var(--line-strong)",
	grid: "var(--line)",
	label: "var(--fg-3)",
	track: "var(--raised)",
	attention: "var(--attention)",
	/** The dot's ring, so it reads on any fill. */
	ring: "var(--surface)",
} as const;

/** series-1 is the accent; use them in order (R19). */
export const SERIES = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--series-${n})`);

/** The series token for a 1-based slot, wrapping after 8. */
export function seriesColor(slot: number): string {
	return SERIES[(slot - 1 + SERIES.length) % SERIES.length] ?? COLOR.accent;
}

/** The category token for a 1-based slot (1 to 21). */
export function categoryColor(slot: number): string {
	return `var(--category-${slot})`;
}

export const STROKE = {
	line: 2,
	previous: 1.5,
	/** Dashes of the comparison line. */
	previousDash: "4 4",
	dot: 5,
	dotRing: 2,
} as const;

/** 12px labels, the type floor (R12). */
export const LABEL = { fontSize: 12, fill: COLOR.label } as const;

/** Inner margins per kind: room for axis labels and the end dot. */
export const MARGIN = {
	/** Room for the end dot (radius 5 and its 2px ring) so it never clips. */
	pace: { top: 8, right: 8, bottom: 0, left: 8 },
	bars: { top: 8, right: 0, bottom: 0, left: 0 },
	area: { top: 10, right: 8, bottom: 0, left: 0 },
} as const;

/** Bars: the widest a bar gets, its corner radius, the y label column. */
export const BAR = { maxSize: 48, radius: 4, yAxisWidth: 44 } as const;

/** Thin bars (ranked, allocation, balance), in px. */
export const THIN = { ranked: 8, allocation: 10, balance: 12, gap: 2 } as const;

/**
 * Motion (R24): charts draw in place. Animation only plays when the person
 * has not asked for reduced motion, and never longer than the row token.
 */
export const MOTION = { duration: 200, easing: "ease-out" } as const;

/** "Nice" top of a value axis: 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceMax(max: number): number {
	if (max <= 0) return 1;
	const power = 10 ** Math.floor(Math.log10(max));
	const m = max / power;
	const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
	return step * power;
}

/**
 * A bar's length as a share of the longest, for ranked bars. Geometry only:
 * the amounts shown next to the bars come from the server as they are.
 */
export function barShare(value: number, max: number): number {
	if (max <= 0 || value <= 0) return 0;
	return Math.max(1, (value / max) * 100);
}

/** Which points of a time axis get a label: first, middle, last. */
export function edgeTicks<T>(points: T[]): T[] {
	if (points.length <= 3) return points;
	const mid = points[Math.floor(points.length / 2)];
	const out = [points[0], mid, points[points.length - 1]];
	return out.filter((p): p is T => p !== undefined);
}
