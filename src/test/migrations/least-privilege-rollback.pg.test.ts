// The rollback snippet for 20261109600000_least_privilege (prisma/rollback/,
// not a migration). An image rollback cannot undo a migration, so the snippet
// has to put the grants, the row-level security and the default privileges
// back by hand.
//
// This creates no database: creating and dropping one holds a transaction id
// long enough to stall the outbox horizon every other pg worker waits on. It
// runs on the worker's own migrated database, in one transaction that always
// ends in ROLLBACK, so nothing it does outlives the test:
//   1. capture the migrated catalog (A);
//   2. run the rollback snippet and capture again (B);
//   3. run the migration again and capture a third time (C).
// B, for the tables the migration touches and the table and sequence default
// privileges, must equal pre-least-privilege-catalog.json, the catalog of a
// database migrated to the migration before this one. C must equal A. The
// grants, row-level security and policy statements are all transactional.
//
// Regenerate the JSON only if an earlier migration is ever rewritten: migrate
// a scratch database to 20261109400000_widen_more_user_text (the migration
// before this one) and write onlyTables(await readCatalogSnapshot(client),
// TOUCHED) to the file with the `<owner>` placeholder as readCatalogSnapshot
// produces it.
//
// Function default privileges are not compared: the migration shares that
// change with the definer hygiene migration, whose rollback owns it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inRolledBackTransaction } from "~/test/rolled-back-sql";
import { REPO_ROOT } from "../uiRules/paths";
import before from "./pre-least-privilege-catalog.json";
import {
	type CatalogSnapshot,
	onlyTables,
	readCatalogSnapshot,
} from "./privilege-catalog";

const MIGRATION = "20261109600000_least_privilege";

/** The tables the migration changes; the rest of the catalog is not compared with the file. */
const TOUCHED = [
	"user",
	"_prisma_migrations",
	"verification",
	"verification_token",
	"password_reset_token",
	"session",
	"account",
	"twoFactor",
	"username_history",
	"event_log",
	"app_settings",
	"invite_code",
	"system_status",
	"audit_log_entry",
	"error_report",
];

const migrationSql = readFileSync(
	join(REPO_ROOT, "prisma/migrations", MIGRATION, "migration.sql"),
	"utf8",
);
const rollbackSql = readFileSync(
	join(REPO_ROOT, "prisma/rollback", `${MIGRATION}.sql`),
	"utf8",
);

describe("rollback of 20261109600000_least_privilege", () => {
	it("puts back every grant, policy, security flag and default the migration changed", async () => {
		let migrated: CatalogSnapshot | undefined;
		let rolledBackTo: CatalogSnapshot | undefined;
		let reapplied: CatalogSnapshot | undefined;
		await inRolledBackTransaction(async (client) => {
			migrated = await readCatalogSnapshot(client);
			await client.query(rollbackSql);
			rolledBackTo = await readCatalogSnapshot(client);
			await client.query(migrationSql);
			reapplied = await readCatalogSnapshot(client);
		});
		if (!migrated || !rolledBackTo || !reapplied) throw new Error("no capture");

		// The migration did change things, so the comparisons below can fail.
		expect(migrated.security).toContain("user rls=true force=false");
		expect(migrated.security).toContain("invite_code rls=true force=false");
		expect(rolledBackTo.security).toContain("user rls=false force=false");
		expect(migrated.acl).not.toEqual(rolledBackTo.acl);

		const expected = before as CatalogSnapshot;
		const restored = onlyTables(rolledBackTo, TOUCHED);
		expect(restored.acl).toEqual(expected.acl);
		expect(restored.security).toEqual(expected.security);
		expect(restored.policies).toEqual(expected.policies);
		expect(restored.defaults).toEqual(expected.defaults);

		// Migrating again lands exactly where the first migration did.
		expect(reapplied).toEqual(migrated);
	}, 60_000);

	it("can run twice, and so can the migration", async () => {
		const seen: Record<string, CatalogSnapshot> = {};
		await inRolledBackTransaction(async (client) => {
			await client.query(rollbackSql);
			seen.once = await readCatalogSnapshot(client);
			await client.query(rollbackSql);
			seen.twice = await readCatalogSnapshot(client);
			await client.query(migrationSql);
			seen.migratedOnce = await readCatalogSnapshot(client);
			await client.query(migrationSql);
			seen.migratedTwice = await readCatalogSnapshot(client);
		});
		expect(seen.twice).toEqual(seen.once);
		expect(seen.migratedTwice).toEqual(seen.migratedOnce);
	}, 60_000);

	it("leaves the database as it found it", async () => {
		let rls: boolean | undefined;
		await inRolledBackTransaction(async (client) => {
			const { rows } = await client.query<{ rls: boolean }>(
				`SELECT relrowsecurity AS rls FROM pg_class WHERE oid = '"user"'::regclass`,
			);
			rls = rows[0]?.rls;
		});
		expect(rls).toBe(true);
	});
});
