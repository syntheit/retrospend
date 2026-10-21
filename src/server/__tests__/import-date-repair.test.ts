import { describe, expect, it } from "vitest";
import { planImportDateRepair } from "../import-date-repair";

const BA = "America/Argentina/Buenos_Aires";

describe("planImportDateRepair", () => {
	it("moves queue imports from midnight UTC to local midnight of the same date", () => {
		const fixes = planImportDateRepair(
			[
				{ id: "a", date: new Date("2026-10-01T00:00:00Z"), pricingSource: "IMPORT" },
				{ id: "b", date: new Date("2026-10-02T00:00:00Z"), pricingSource: "IMPORTED" },
			],
			BA,
		);
		expect(fixes.map((f) => [f.id, f.to.toISOString()])).toEqual([
			["a", "2026-10-01T03:00:00.000Z"],
			["b", "2026-10-02T03:00:00.000Z"],
		]);
	});

	it("leaves form expenses, rows already at local midnight and UTC users alone", () => {
		const rows = [
			{ id: "form", date: new Date("2026-10-01T00:00:00Z"), pricingSource: "blue" },
			{ id: "local", date: new Date("2026-10-01T03:00:00Z"), pricingSource: "IMPORT" },
			{ id: "timed", date: new Date("2026-10-01T15:42:00Z"), pricingSource: "IMPORT" },
			{ id: "none", date: new Date("2026-10-01T00:00:00Z"), pricingSource: null },
		];
		expect(planImportDateRepair(rows, BA)).toEqual([]);
		expect(
			planImportDateRepair(
				[{ id: "utc", date: new Date("2026-10-01T00:00:00Z"), pricingSource: "IMPORT" }],
				"UTC",
			),
		).toEqual([]);
	});

	it("east of UTC moves back to the same calendar date", () => {
		const [fix] = planImportDateRepair(
			[{ id: "a", date: new Date("2026-10-01T00:00:00Z"), pricingSource: "IMPORT" }],
			"Europe/Berlin",
		);
		expect(fix!.to.toISOString()).toBe("2026-09-30T22:00:00.000Z");
	});
});
