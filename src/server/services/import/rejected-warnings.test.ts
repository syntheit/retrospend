import { describe, expect, it } from "vitest";
import { completedJobData, rejectedRowWarnings } from "./rejected-warnings";

const rows = (n: number) =>
	Array.from({ length: n }, (_, row) => ({ row, reason: "why" }));

describe("rejectedRowWarnings", () => {
	it("is empty when nothing was refused", () => {
		expect(rejectedRowWarnings([])).toEqual([]);
	});

	it("counts every row but lists only the first ten", () => {
		expect(rejectedRowWarnings(rows(1))).toEqual([
			"1 row was not imported: why (selected rows 1)",
		]);
		expect(rejectedRowWarnings(rows(12))).toEqual([
			"12 rows were not imported: why (selected rows 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 and 2 more)",
		]);
	});
});

describe("completedJobData", () => {
	const done = { count: 4, skippedDuplicates: 2 };

	it("completes the job with the counts and leaves its warnings alone when nothing was refused", () => {
		const data = completedJobData(
			{ warnings: ["old"] },
			{ ...done, rejected: [] },
		);
		expect(data).toMatchObject({
			status: "COMPLETED",
			importedCount: 4,
			skippedDuplicates: 2,
		});
		expect(data).not.toHaveProperty("warnings");
	});

	it("adds to the existing warnings, or starts them when there are none", () => {
		const warning = "1 row was not imported: why (selected rows 1)";
		expect(
			completedJobData({ warnings: ["old"] }, { ...done, rejected: rows(1) })
				.warnings,
		).toEqual(["old", warning]);
		expect(
			completedJobData({ warnings: null }, { ...done, rejected: rows(1) })
				.warnings,
		).toEqual([warning]);
	});
});
