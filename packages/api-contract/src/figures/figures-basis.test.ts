import { describe, expect, it } from "vitest";
import { figuresResultSchema } from "./index";

const figures = [{ id: "spent", lines: [{ minor: 1234, currency: "USD" }] }];
const basis = {
	asOf: "eyJlIjoiMSIsInQiOiI5IiwicyI6IjEifQ",
	cut: "eyJlIjoiMSIsInQiOiI3IiwicyI6IjEifQ",
	at: "2026-12-01T01:30:00.000Z",
	ratesAsOf: "2026-11-30T12:00:00.000Z",
	home: "EUR",
	timeZone: "America/Argentina/Buenos_Aires",
	startDay: 15,
};

describe("figures result basis", () => {
	it("is optional, so an older server's answer still parses", () => {
		expect(figuresResultSchema.safeParse({ figures }).success).toBe(true);
	});

	it("carries the read's cursor, instant, rate stamp and settings", () => {
		const parsed = figuresResultSchema.parse({ figures, basis });
		expect(parsed.basis).toEqual(basis);
		expect(
			figuresResultSchema.safeParse({
				figures,
				basis: { ...basis, ratesAsOf: null },
			}).success,
		).toBe(true);
	});

	it("refuses a basis missing a field or with a start day off the calendar", () => {
		const { home: _home, ...noHome } = basis;
		for (const bad of [
			noHome,
			{ ...basis, startDay: 0 },
			{ ...basis, startDay: 32 },
		])
			expect(
				figuresResultSchema.safeParse({ figures, basis: bad }).success,
			).toBe(false);
	});
});
