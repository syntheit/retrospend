import { DEFAULT_RANGE, datesFor, RANGES, sliceRange } from "./series";
import type { SeriesPoint } from "./source";

function series(count: number): SeriesPoint[] {
	return Array.from({ length: count }, (_, i) => ({
		date: `d${i}`,
		value: { minor: i * 100, currency: "ARS" },
	}));
}

describe("range", () => {
	it("offers five ranges and opens on the month the headline names", () => {
		expect(RANGES).toEqual(["1M", "3M", "6M", "1Y", "All"]);
		expect(DEFAULT_RANGE).toBe("1M");
	});

	it("takes today and the days before it", () => {
		const all = series(366);
		expect(sliceRange(all, "1M")).toHaveLength(31);
		expect(sliceRange(all, "3M")).toHaveLength(91);
		expect(sliceRange(all, "1Y")).toHaveLength(366);
		expect(sliceRange(all, "1M").at(-1)).toBe(all.at(-1));
		expect(sliceRange(series(10), "1M")).toHaveLength(10);
	});

	it("shows every point for All", () => {
		expect(sliceRange(series(200), "All")).toHaveLength(200);
	});

	it("labels days up to six months and months beyond", () => {
		expect(datesFor("1M")).toBe("day");
		expect(datesFor("6M")).toBe("day");
		expect(datesFor("1Y")).toBe("month");
		expect(datesFor("All")).toBe("month");
	});
});
