// The month spend line: this month against last, cumulative per day. The
// server sends the running totals (glance.pace); this only places them on a
// canvas. Nothing here adds up money.

export interface PaceInput {
	/** Running totals in home minor units, one per day so far; null: none. */
	current: readonly number[] | null;
	previous: readonly number[] | null;
}

export interface PaceLines {
	current: readonly number[];
	previous: readonly number[];
}

/** A series with nothing spent reads as no data, never as a flat zero line. */
const spent = (values: readonly number[] | null): readonly number[] =>
	values?.some((v) => v !== 0) ? values : [];

/**
 * The series to draw. Last month alone still draws (this month at zero so
 * far); with nothing in either, the chart says there is no data.
 */
export function paceLines(input: PaceInput): PaceLines {
	const previous = spent(input.previous);
	const current = spent(input.current);
	if (current.length === 0 && previous.length === 0) {
		return { current: [], previous: [] };
	}
	return { current: input.current ?? [], previous };
}

export interface PaceShape {
	current: string;
	previous: string;
	/** The dot at today, where this month's line ends. */
	end: { x: number; y: number } | null;
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Path data for both lines in a width by height box, `inset` from every edge. */
export function paceShape(
	lines: PaceLines,
	days: number,
	width: number,
	height: number,
	inset: number,
): PaceShape {
	const top = Math.max(...lines.current, ...lines.previous, 1);
	const x = (i: number) =>
		inset + (days <= 1 ? 0 : (i / (days - 1)) * (width - 2 * inset));
	// A little headroom so the highest point is not on the edge.
	const y = (v: number) =>
		inset + (1 - v / (top * 1.04)) * (height - 2 * inset);
	const path = (values: readonly number[]) =>
		values
			.map((v, i) => `${i === 0 ? "M" : "L"}${round(x(i))} ${round(y(v))}`)
			.join(" ");
	const last = lines.current.length - 1;
	return {
		current: path(lines.current),
		previous: path(lines.previous),
		end:
			last >= 0
				? { x: round(x(last)), y: round(y(lines.current[last] ?? 0)) }
				: null,
	};
}
