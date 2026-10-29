import { light } from "@retrospend/tokens/theme";
import { areaShape, nearestIndex, type Plot, xAt } from "./area";
import {
	categoryColor,
	chartColors,
	edgeTicks,
	MARGIN,
	niceMax,
	seriesColor,
} from "./chartSpec";

const plot: Plot = { width: 208, height: 110, margin: MARGIN.area };

describe("areaShape", () => {
	it("spreads the points edge to edge inside the margins", () => {
		expect(xAt(0, 3, plot)).toBe(0);
		expect(xAt(2, 3, plot)).toBe(200);
		expect(xAt(0, 1, plot)).toBe(100);
	});

	it("draws one line and one closed fill down to the axis", () => {
		const shape = areaShape([100, 200, 300], plot);
		expect(shape.line.match(/M/g)).toHaveLength(1);
		expect(shape.area.endsWith(`L0 ${shape.base}Z`)).toBe(true);
		expect(shape.base).toBe(110);
		// The highest value sits under the top margin, never at the edge.
		const top = Math.min(...shape.ys.filter((y): y is number => y !== null));
		expect(top).toBeGreaterThan(MARGIN.area.top);
	});

	it("breaks the line at a gap and never draws a missing day as zero", () => {
		const shape = areaShape([100, null, 300, 400], plot);
		expect(shape.line.match(/M/g)).toHaveLength(2);
		expect(shape.area.match(/Z/g)).toHaveLength(2);
		expect(shape.ys[1]).toBeNull();
	});

	it("puts the end dot on the last known point", () => {
		const shape = areaShape([100, 300, null], plot);
		expect(shape.end).toEqual({ x: 100, y: shape.ys[1] });
	});

	it("draws a flat series across the middle", () => {
		const shape = areaShape([500, 500], plot);
		expect(shape.ys[0]).toBe(shape.ys[1]);
		expect(shape.ys[0]).toBe(60);
	});

	it("draws nothing without a known value", () => {
		const shape = areaShape([null, null], plot);
		expect(shape.line).toBe("");
		expect(shape.end).toBeNull();
	});
});

describe("nearestIndex", () => {
	it("finds the point under a finger and clamps at the edges", () => {
		expect(nearestIndex(0, 5, plot)).toBe(0);
		expect(nearestIndex(101, 5, plot)).toBe(2);
		expect(nearestIndex(-40, 5, plot)).toBe(0);
		expect(nearestIndex(500, 5, plot)).toBe(4);
	});
});

describe("spec", () => {
	it("labels the first, middle and last point", () => {
		expect(edgeTicks([1, 2, 3, 4, 5])).toEqual([1, 3, 5]);
		expect(edgeTicks([1, 2])).toEqual([1, 2]);
	});

	it("reads chart colors from the tokens", () => {
		const tone = chartColors(light.color);
		expect(tone.accent).toBe(light.color.accent);
		expect(tone.cross).toBe(light.color.lineStrong);
		expect(tone.ring).toBe(light.color.surface);
		expect(seriesColor(light.color, 1)).toBe(light.color.series1);
		expect(seriesColor(light.color, 9)).toBe(light.color.series1);
		expect(categoryColor(light.color, 21)).toBe(light.color.category21);
	});

	it("rounds an axis top to a nice number", () => {
		expect(niceMax(0)).toBe(1);
		expect(niceMax(130)).toBe(200);
		expect(niceMax(2400)).toBe(2500);
	});
});
