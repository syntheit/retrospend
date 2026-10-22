// Runs the golden percent and date vectors (display-format.vectors.json).
import { describe, expect, it } from "vitest";
import { type DateStyle, daysBetween, formatDate } from "../src/format-date";
import {
	type FormatPercentOptions,
	formatPercent,
} from "../src/format-percent";
import vectors from "./display-format.vectors.json";

type PercentCase = {
	name: string;
	locale: string;
	basis: number;
	options?: Omit<FormatPercentOptions, "locale">;
	expected: string;
};
type DateCase = {
	name: string;
	locale: string;
	iso: string;
	style: DateStyle;
	expected: string;
};
type DaysCase = { name: string; from: string; to: string; expected: number };

describe("formatPercent vectors", () => {
	for (const c of vectors.percent as PercentCase[])
		it(c.name, () => {
			expect(formatPercent(c.basis, { locale: c.locale, ...c.options })).toBe(
				c.expected,
			);
		});

	it("refuses a fractional basis", () => {
		expect(() => formatPercent(12.5, { locale: "en-US" })).toThrow(RangeError);
	});
});

describe("formatDate vectors", () => {
	for (const c of vectors.date as DateCase[])
		it(c.name, () => {
			expect(formatDate(c.iso, { locale: c.locale, style: c.style })).toBe(
				c.expected,
			);
		});

	it("refuses anything but an ISO date", () => {
		expect(() =>
			formatDate("10/19/2026", { locale: "en-US", style: "short" }),
		).toThrow(RangeError);
	});

	for (const c of vectors.daysBetween as DaysCase[])
		it(`daysBetween: ${c.name}`, () => {
			expect(daysBetween(c.from, c.to)).toBe(c.expected);
		});
});
