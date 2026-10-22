import { describe, expect, it } from "vitest";
import { findBannedOutput } from "./banned-output";

describe("findBannedOutput", () => {
	it("passes ordinary copy", () => {
		const text = [
			"Spent in October ARS 1,895,200",
			"Nancy owes you US$12.50",
			"Used 999.9% of the plan",
			"Exactly 1000% is still allowed",
			"Up 12% (+1.2%) since last month",
			"No projects yet",
			"C++ tips",
			"Symbols Math + − × ÷ %",
			"Balance −ARS 41,100",
			"Call +54 9 11 1234-5678",
			"Oct 1 - Oct 5",
			"2026-10-22",
		].join("\n");
		expect(findBannedOutput(text, "en-US")).toEqual([]);
	});

	it("finds NaN and Infinity", () => {
		expect(findBannedOutput("Left to spend ARS NaN", "en-US")).toEqual([
			'NaN: "Left to spend ARS NaN"',
		]);
		expect(findBannedOutput("Runway Infinity months", "en-US")).toHaveLength(1);
		expect(findBannedOutput("Runway ∞", "en-US")).toHaveLength(1);
	});

	it("finds doubled signs before an amount, with or without spaces", () => {
		expect(findBannedOutput("Change +−ARS 1,200", "en-US")).toHaveLength(1);
		expect(findBannedOutput("Change −+1,200", "en-US")).toHaveLength(1);
		expect(findBannedOutput("Change +-$12", "en-US")).toHaveLength(1);
		expect(findBannedOutput("Change −−ARS 5", "en-US")).toHaveLength(1);
		expect(findBannedOutput("Change + −ARS 1,200", "en-US")).toHaveLength(1);
	});

	it("does not join signs across a line break", () => {
		// A "+" button above a negative amount.
		expect(findBannedOutput("+\n−ARS 1,200", "en-US")).toEqual([]);
	});

	it("finds percentages above 1000% in the page locale", () => {
		expect(findBannedOutput("Used 1,250%", "en-US")).toEqual([
			'percent above 1000%: "1,250%"',
		]);
		expect(findBannedOutput("Usado 1.250 %", "es-AR")).toEqual([
			'percent above 1000%: "1.250 %"',
		]);
		// The same text in en-US is 1.25%.
		expect(findBannedOutput("Used 1.250%", "en-US")).toEqual([]);
		expect(findBannedOutput("Used 1000.1%", "en-US")).toHaveLength(1);
	});

	it("finds the No project phantom as the app writes it, and only that", () => {
		expect(
			findBannedOutput("Martín · No project: owes you ARS 3,000", "en-US"),
		).toEqual([
			'No project phantom: "Martín · No project: owes you ARS 3,000"',
		]);
		expect(findBannedOutput("Sin proyecto: te debe", "es-AR")).toHaveLength(1);
		expect(
			findBannedOutput(
				"Add it to a trip, or keep it as no project at all",
				"en-US",
			),
		).toEqual([]);
		expect(findBannedOutput("sin proyecto", "es-AR")).toEqual([]);
	});
});
