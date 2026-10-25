import {
	columnHeights,
	downsample,
	endsOf,
	indexAt,
	RANGES,
	sliceRange,
} from "./series";
import type { SeriesPoint } from "./source";

const day = (n: number) => `2026-01-${String(n).padStart(2, "0")}`;
const point = (n: number, minor: number | null): SeriesPoint => ({
	date: day(n),
	value: minor === null ? null : { minor, currency: "ARS" },
});

function series(count: number): SeriesPoint[] {
	return Array.from({ length: count }, (_, i) => ({
		date: `d${i}`,
		value: { minor: i * 100, currency: "ARS" },
	}));
}

describe("range", () => {
	it("offers four ranges", () => {
		expect(RANGES).toEqual(["1M", "3M", "6M", "1Y"]);
	});

	it("takes today and the days before it", () => {
		const all = series(366);
		expect(sliceRange(all, "1M")).toHaveLength(31);
		expect(sliceRange(all, "3M")).toHaveLength(91);
		expect(sliceRange(all, "1Y")).toHaveLength(366);
		expect(sliceRange(all, "1M").at(-1)).toBe(all.at(-1));
		expect(sliceRange(series(10), "1M")).toHaveLength(10);
	});
});

describe("columns", () => {
	it("keeps every point when they fit", () => {
		expect(downsample(series(10), 20)).toHaveLength(10);
	});

	it("ends on the last day and never exceeds the limit", () => {
		const all = series(366);
		const out = downsample(all, 100);
		expect(out).toHaveLength(100);
		expect(out.at(-1)).toBe(all.at(-1));
		// Each column keeps a real day, in order.
		const days = out.map((p) => Number(p.date.slice(1)));
		expect([...days].sort((a, b) => a - b)).toEqual(days);
	});

	it("finds the column under a finger and clamps at the edges", () => {
		expect(indexAt(0, 300, 30)).toBe(0);
		expect(indexAt(149, 300, 30)).toBe(14);
		expect(indexAt(150, 300, 30)).toBe(15);
		expect(indexAt(-20, 300, 30)).toBe(0);
		expect(indexAt(999, 300, 30)).toBe(29);
		expect(indexAt(5, 0, 30)).toBe(0);
		expect(indexAt(5, 300, 0)).toBe(0);
	});
});

describe("heights", () => {
	it("scales between the lowest and highest value with a floor", () => {
		const heights = columnHeights(
			[point(1, 1000), point(2, 2000), point(3, 3000)].map((p) => p.value),
			100,
			10,
		);
		expect(heights).toEqual([10, 55, 100]);
	});

	it("leaves a gap for a day with no value", () => {
		const heights = columnHeights(
			[point(1, 100), point(2, null), point(3, 300)].map((p) => p.value),
			50,
			0,
		);
		expect(heights).toEqual([0, null, 50]);
	});

	it("draws a flat series at half height and an all-gap series as gaps", () => {
		expect(
			columnHeights([point(1, 5), point(2, 5)].map((p) => p.value), 40, 4),
		).toEqual([20, 20]);
		expect(columnHeights([null, null], 40, 4)).toEqual([null, null]);
	});

	it("handles a series that falls below zero", () => {
		const heights = columnHeights(
			[point(1, -500), point(2, 500)].map((p) => p.value),
			100,
			0,
		);
		expect(heights).toEqual([0, 100]);
	});
});

describe("ends", () => {
	it("skips days with no value at either end", () => {
		const ends = endsOf([point(1, null), point(2, 5), point(3, 9), point(4, null)]);
		expect(ends.first?.date).toBe(day(2));
		expect(ends.last?.date).toBe(day(3));
		expect(endsOf([])).toEqual({ first: null, last: null });
	});
});
