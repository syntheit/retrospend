import { describe, expect, it } from "vitest";
import {
	monthRange,
	monthStartIso,
	parseMonthParam,
	shiftMonth,
} from "./months";

describe("months", () => {
	it("steps over a year boundary both ways", () => {
		expect(shiftMonth(202612, 1)).toBe(202701);
		expect(shiftMonth(202601, -1)).toBe(202512);
		expect(shiftMonth(202610, 0)).toBe(202610);
	});

	it("names the first day", () => {
		expect(monthStartIso(202603)).toBe("2026-03-01");
	});

	it("lists the start month to the month after the current one", () => {
		expect(monthRange(202611, 202701)).toEqual([
			202611, 202612, 202701, 202702,
		]);
	});

	it("accepts only real YYYYMM values", () => {
		expect(parseMonthParam("202610")).toBe(202610);
		expect(parseMonthParam("202613")).toBeNull();
		expect(parseMonthParam("oct")).toBeNull();
		expect(parseMonthParam(null)).toBeNull();
	});
});
