// The recovery around `prisma migrate deploy` that docker-entrypoint.sh used to
// do in shell, now in scripts/db-owner, with the Prisma CLI replaced by a
// recording fake. The live behavior (a real failing migration, a real P3009) is
// in src/test/migrations/owner-role.pg.test.ts.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	applyGrants,
	migrateWithRecovery,
	PROJECT_ROOT,
} from "../../../scripts/db-owner/index.mjs";

type Reply = { status: number | null; output: string };
const ok: Reply = { status: 0, output: "" };

/** A runner that answers the calls in order and records their arguments. */
function runner(...replies: Reply[]) {
	const calls: string[][] = [];
	const run = async (args: string[]) => {
		calls.push(args);
		return replies[calls.length - 1] ?? ok;
	};
	return { run, calls };
}

const quiet = () => undefined;

describe("migrateWithRecovery", () => {
	it("migrates once when nothing is wrong", async () => {
		const { run, calls } = runner(ok);
		await migrateWithRecovery("postgresql://x", { run, log: quiet });
		expect(calls).toEqual([["migrate", "deploy"]]);
	});

	it("P3009: marks the failed migration rolled back and migrates again", async () => {
		const { run, calls } = runner(
			{
				status: 1,
				output:
					"Error: P3009\n\nmigrate found failed migrations in the target database\nThe `20300102000000_breaks` migration started at 2030-01-02 failed\n",
			},
			ok,
			ok,
		);
		await migrateWithRecovery("postgresql://x", { run, log: quiet });
		expect(calls).toEqual([
			["migrate", "deploy"],
			["migrate", "resolve", "--rolled-back", "20300102000000_breaks"],
			["migrate", "deploy"],
		]);
	});

	it("P3009: stops when the name cannot be read, or the second try fails", async () => {
		await expect(
			migrateWithRecovery("postgresql://x", {
				run: runner({ status: 1, output: "P3009 and nothing else" }).run,
				log: quiet,
			}),
		).rejects.toThrow(/could not parse migration name/);
		await expect(
			migrateWithRecovery("postgresql://x", {
				run: runner(
					{ status: 1, output: "P3009 The `m_one` migration failed" },
					ok,
					{ status: 1, output: "again" },
				).run,
				log: quiet,
			}),
		).rejects.toThrow(/migrate deploy failed/);
	});

	it("P3005: baselines at the first migration folder, then migrates", async () => {
		const first = readdirSync(join(PROJECT_ROOT, "prisma", "migrations"), {
			withFileTypes: true,
		})
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort()[0];
		const { run, calls } = runner(
			{ status: 1, output: "Error: P3005" },
			ok,
			ok,
		);
		await migrateWithRecovery("postgresql://x", { run, log: quiet });
		expect(first).toBeTruthy();
		expect(calls).toEqual([
			["migrate", "deploy"],
			["migrate", "resolve", "--applied", first],
			["migrate", "deploy"],
		]);
	});

	it("P3005: stops when the baseline cannot be resolved", async () => {
		await expect(
			migrateWithRecovery("postgresql://x", {
				run: runner({ status: 1, output: "P3005" }, { status: 1, output: "" })
					.run,
				log: quiet,
			}),
		).rejects.toThrow(/Failed to resolve baseline/);
	});

	it("stops on any other failure, after one try", async () => {
		const { run, calls } = runner({ status: 1, output: "P1001 can't reach" });
		await expect(
			migrateWithRecovery("postgresql://x", { run, log: quiet }),
		).rejects.toThrow(/Migration failed/);
		expect(calls).toHaveLength(1);
	});
});

describe("applyGrants", () => {
	it("runs the grants file, and fails the start when it fails", async () => {
		const good = runner(ok);
		await applyGrants("postgresql://x", { run: good.run });
		expect(good.calls).toEqual([
			["db", "execute", "--file", "prisma/grants/app-role.sql"],
		]);
		await expect(
			applyGrants("postgresql://x", {
				run: runner({ status: 1, output: "" }).run,
			}),
		).rejects.toThrow(/grants file failed/);
	});
});
