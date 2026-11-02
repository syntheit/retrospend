import { light } from "@retrospend/tokens/theme";
import type { Theme } from "@/theme";

/**
 * The one chart spec on native (GUIDELINE §9), the twin of the web's
 * `src/components/charts/spec.ts`: the same roles, strokes, margins and
 * label size, so a chart drawn here matches the web one. Colors are theme
 * tokens only: a single series is the accent, several take series 1 to 8 in
 * order, categories only in category charts, attention only for over budget.
 * Labels are 12 fg-3. Gaps are null, never zero.
 */

type Colors = Theme["color"];

/** Token colors by chart role, for the current theme. */
export function chartColors(color: Colors) {
	return {
		accent: color.accent,
		/** The area under a line: the accent at `OPACITY.area`. */
		area: color.accent,
		/** Last period, the comparison line. */
		previous: color.fg3,
		axis: color.lineStrong,
		grid: color.line,
		label: color.fg3,
		track: color.raised,
		attention: color.attention,
		/** The scrub crosshair. */
		cross: color.lineStrong,
		/** The end dot's ring, so it reads on any fill. */
		ring: color.surface,
	} as const;
}

/**
 * Fills that the web mixes in CSS (`color-mix`): the area at 16% of the
 * accent, the other bars of a highlight chart at 30%.
 */
export const OPACITY = { area: 0.16, accentDim: 0.3 } as const;

const SERIES_KEYS = [
	"series1",
	"series2",
	"series3",
	"series4",
	"series5",
	"series6",
	"series7",
	"series8",
] as const;

/** The series token for a 1-based slot, wrapping after 8. series 1 is the accent (R19). */
export function seriesColor(color: Colors, slot: number): string {
	const key = SERIES_KEYS[(slot - 1 + SERIES_KEYS.length) % SERIES_KEYS.length];
	return key ? color[key] : color.accent;
}

/** The category token for a 1-based slot (1 to 21). */
export function categoryColor(color: Colors, slot: number): string {
	const key = `category${slot}` as keyof Colors;
	return key in color ? (color[key] as string) : color.fg3;
}

export const STROKE = {
	line: light.chart.line,
	previous: 1.5,
	/** Dashes of the comparison line. */
	previousDash: "4 4",
	dot: light.chart.dot,
	dotRing: light.chart.ring,
	axis: 1,
	cross: 1,
} as const;

/** Inner margins per kind: room for the end dot (radius 5 and its 2pt ring) so it never clips. */
export const MARGIN = {
	pace: { top: 8, right: 8, bottom: 0, left: 8 },
	bars: { top: 8, right: 0, bottom: 0, left: 0 },
	area: { top: 10, right: 8, bottom: 0, left: 0 },
} as const;

export type Margin = (typeof MARGIN)[keyof typeof MARGIN];

/** The time axis under a chart: its row height (labels at 12 sit in it). */
export const AXIS = { height: 22 } as const;

/** Thin bars (ranked, allocation, balance), in pt. */
export const THIN = { ranked: 8, allocation: 10, balance: 12, gap: 2 } as const;

/**
 * Scrubbing on a phone: drag sideways at once (it starts after `startPx` of
 * sideways travel, and gives way to the page scroll after `failPx` of
 * vertical travel), or press and hold `holdMs` and then drag any way for a
 * precise read.
 */
export const SCRUB = { holdMs: 240, startPx: 8, failPx: 12 } as const;

/** Which points of a time axis get a label: first, middle, last. */
export function edgeTicks<T>(points: readonly T[]): T[] {
	if (points.length <= 3) return [...points];
	const mid = points[Math.floor(points.length / 2)];
	const out = [points[0], mid, points[points.length - 1]];
	return out.filter((p): p is T => p !== undefined);
}
