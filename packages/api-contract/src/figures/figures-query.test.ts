import { describe, expect, it } from "vitest";
import { figuresQuerySchema } from "./index";

const month = (value: string) =>
	figuresQuerySchema.safeParse({ ids: "insights.byMonth", month: value })
		.success;

describe("figures query month", () => {
	it("takes a fiscal month label from 01 to 12", () => {
		expect(month("2026-01")).toBe(true);
		expect(month("2026-10")).toBe(true);
		expect(month("2026-12")).toBe(true);
	});

	it("refuses months the date parser would roll into another month", () => {
		// 2026-13 used to read January 2027 and 2026-00 December 2025.
		expect(month("2026-13")).toBe(false);
		expect(month("2026-00")).toBe(false);
		expect(month("2026-1")).toBe(false);
	});
});
