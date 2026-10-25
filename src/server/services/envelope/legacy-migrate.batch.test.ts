import { describe, expect, it } from "vitest";
import { needsAttention } from "./legacy-migrate.batch";
import { emptyReport, type MigrationStatus } from "./legacy-migrate.service";

const report = (
	status: MigrationStatus,
	extra: Partial<ReturnType<typeof emptyReport>> = {},
) => ({ ...emptyReport("u", status), ...extra });

const good = { funded: true, invariantOk: true };

describe("needsAttention (the script's exit code, with and without --json)", () => {
	it("is 0 when everyone moved, had a book or has nothing to move", () => {
		expect(
			needsAttention([
				report("MIGRATED", good),
				report("HAS_BOOK"),
				report("NOTHING_TO_MIGRATE"),
				report("NO_BUDGETS"),
			]),
		).toBe(0);
	});

	it("counts a skipped person, an error and a book that is unfunded, unbalanced or warned about", () => {
		expect(
			needsAttention([
				report("MISSING_RATE", { missingRates: ["ARS"] }),
				report("ERROR", { warnings: ["boom"] }),
				report("MIGRATED", { funded: false, invariantOk: true }),
				report("MIGRATED", { funded: true, invariantOk: false }),
				report("MIGRATED", {
					...good,
					warnings: ["funded 1 but the plan said 2"],
				}),
				report("MIGRATED", good),
			]),
		).toBe(5);
	});
});
