import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEpochForTests } from "~/server/crypto/epoch";
import { setSealingForTests } from "~/server/crypto/sealing";
import { migrateUsers, needsAttention } from "./legacy-migrate.batch";
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

describe("migrateUsers after the field encryption epoch", () => {
	afterEach(() => {
		resetEpochForTests();
		setSealingForTests();
	});
	const empty = () => {
		const findMany = vi.fn(async () => []);
		return { client: { user: { findMany } } as never, findMany };
	};

	it("refuses an apply that would store plaintext, and reads nothing", async () => {
		resetEpochForTests(true);
		setSealingForTests(() => false);
		const { client, findMany } = empty();
		await expect(migrateUsers(client, { apply: true })).rejects.toThrow(
			/plaintext after the field encryption epoch/,
		);
		expect(findMany).not.toHaveBeenCalled();
	});

	it("still runs a dry run, and an apply that seals", async () => {
		resetEpochForTests(true);
		setSealingForTests(() => false);
		const dry = empty();
		await migrateUsers(dry.client, { apply: false });
		expect(dry.findMany).toHaveBeenCalled();
		setSealingForTests(() => true);
		const sealed = empty();
		await migrateUsers(sealed.client, { apply: true });
		expect(sealed.findMany).toHaveBeenCalled();
	});
});
