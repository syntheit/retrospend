import type { Margin } from "./chartSpec";

// The area chart's drawing as plain functions: where each point sits, the
// line and the fill under it, and which point a finger is on. Positions are
// drawing, not money: the figures shown stay the server's.

export interface Plot {
	width: number;
	height: number;
	margin: Margin;
}

export interface AreaShape {
	/** The line, one subpath per run of known values (a null is a gap). */
	line: string;
	/** The fill under the line down to the axis, one closed subpath per run. */
	area: string;
	/** The last known point, where the end dot sits. */
	end: { x: number; y: number } | null;
	/** The axis line's y (the bottom of the plot). */
	base: number;
	/** The x of every point, known or not, for the crosshair. */
	xs: number[];
	/** The y of every point on the line; null where the value is a gap. */
	ys: (number | null)[];
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The x of point `i` of `count`, spread edge to edge inside the margins. */
export function xAt(i: number, count: number, plot: Plot): number {
	const left = plot.margin.left;
	const inner = Math.max(0, plot.width - left - plot.margin.right);
	if (count <= 1) return left + inner / 2;
	return left + (i / (count - 1)) * inner;
}

/**
 * The line and area for a series of values (minor units of one currency).
 * The value range gets 12% of headroom above and below, like the web chart,
 * so a flat series sits mid-plot and the end dot never touches the edge.
 */
export function areaShape(
	values: readonly (number | null)[],
	plot: Plot,
): AreaShape {
	const top = plot.margin.top;
	const base = plot.height - plot.margin.bottom;
	const xs = values.map((_, i) => round(xAt(i, values.length, plot)));
	const known = values.filter((v): v is number => v !== null);
	if (known.length === 0)
		return { line: "", area: "", end: null, base, xs, ys: xs.map(() => null) };
	const low = Math.min(...known);
	const high = Math.max(...known);
	const pad = (high - low) * 0.12 || 1;
	const min = low - pad;
	const span = high + pad - min;
	const yAt = (v: number) => round(base - ((v - min) / span) * (base - top));
	const ys = values.map((v) => (v === null ? null : yAt(v)));

	let line = "";
	let area = "";
	let run: { x: number; y: number }[] = [];
	let end: { x: number; y: number } | null = null;
	const close = () => {
		const first = run[0];
		const last = run[run.length - 1];
		if (first && last) {
			const path = run
				.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`)
				.join("");
			line += path;
			area += `${path}L${last.x} ${base}L${first.x} ${base}Z`;
		}
		run = [];
	};
	for (const [i, y] of ys.entries()) {
		if (y === null) {
			close();
			continue;
		}
		const point = { x: xs[i] ?? 0, y };
		run.push(point);
		end = point;
	}
	close();
	return { line, area, end, base, xs, ys };
}

/** The point nearest a horizontal position, clamped to the series. */
export function nearestIndex(x: number, count: number, plot: Plot): number {
	if (count <= 1) return 0;
	const left = plot.margin.left;
	const inner = Math.max(1, plot.width - left - plot.margin.right);
	const i = Math.round(((x - left) / inner) * (count - 1));
	return Math.max(0, Math.min(count - 1, i));
}
