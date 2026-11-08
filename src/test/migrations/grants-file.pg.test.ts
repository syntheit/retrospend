// prisma/grants/app-role.sql is what the app applies after the migrations on
// every start, so a database restored from a --no-privileges dump gets the app
// role's grants back. It has to say exactly what the migrations leave behind:
// this takes the grants away the way a restore does, applies the file and
// compares the result with the database as migrated and with the privilege
// ratchet (retrospend-app-privileges.json).
//
// It creates no database. Everything runs on the worker's own migrated
// database in one transaction that always ends in ROLLBACK. The file has its
// own BEGIN and COMMIT (so a running app never sees the role half granted);
// they are stripped here so that COMMIT cannot end the test's transaction.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../uiRules/paths";
import {
	type PrivilegeCatalog,
	readCatalogSnapshot,
	readKeystoreAccess,
	readPrivilegeCatalog,
} from "./privilege-catalog";
import expected from "./retrospend-app-privileges.json";

const file = readFileSync(
	join(REPO_ROOT, "prisma/grants/app-role.sql"),
	"utf8",
);

/** What a restore leaves: tables back, no privileges, no policies on the two tables. */
const AS_RESTORED = `
	REVOKE ALL ON ALL TABLES IN SCHEMA public FROM retrospend_app;
	REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM retrospend_app;
	REVOKE USAGE ON SCHEMA public FROM retrospend_app;
	GRANT CREATE ON SCHEMA public TO PUBLIC;
	DROP POLICY IF EXISTS user_select_all ON "user";
	DROP POLICY IF EXISTS user_update_own ON "user";
	DROP POLICY IF EXISTS invite_code_own ON "invite_code";
	ALTER TABLE "user" DISABLE ROW LEVEL SECURITY;
	ALTER TABLE "invite_code" DISABLE ROW LEVEL SECURITY;
	REVOKE USAGE ON SCHEMA keystore FROM retrospend_app;
	REVOKE EXECUTE ON FUNCTION keystore."current_user_data_keys"(), keystore."create_first_data_key"(text, bigint) FROM retrospend_app;
	GRANT EXECUTE ON FUNCTION keystore."current_user_data_keys"(), keystore."create_first_data_key"(text, bigint) TO PUBLIC;
	ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO retrospend_app;
	ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO retrospend_app;
`;

let client: Client;

beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
});

afterAll(async () => {
	await client.end();
});

async function everything() {
	return {
		snapshot: await readCatalogSnapshot(client),
		catalog: await readPrivilegeCatalog(client),
		keystore: await readKeystoreAccess(client),
		publicUsage: (
			await client.query<{ can: boolean }>(
				`SELECT has_schema_privilege('retrospend_app', 'public', 'USAGE') AS can`,
			)
		).rows[0]?.can,
	};
}

/** Runs `work` in a transaction that is always rolled back. */
async function rolledBack<T>(work: () => Promise<T>): Promise<T> {
	await client.query("BEGIN");
	try {
		return await work();
	} finally {
		await client.query("ROLLBACK");
	}
}

describe("prisma/grants/app-role.sql", () => {
	it("runs in one transaction, which this test strips", () => {
		expect(file.match(/^BEGIN;$/gm)).toHaveLength(1);
		expect(file.match(/^COMMIT;$/gm)).toHaveLength(1);
	});

	it("never names the owner role and never grants on all tables", () => {
		const sql = file.replace(/--[^\n]*/g, "");
		expect(sql).not.toMatch(/retrospend_owner/i);
		expect(sql).not.toMatch(/\bGRANT\b[^;]*\bON\s+ALL\b/i);
		// Every grant is to the app role; PUBLIC only loses things.
		for (const grant of sql.match(/\bGRANT\b[^;]*;/gi) ?? []) {
			expect(grant).toMatch(/\bTO\s+retrospend_app\b/i);
		}
	});

	it("after a restore gives the app role back exactly the migrated state", async () => {
		const body = file.replace(/^(BEGIN|COMMIT);$/gm, "");
		const { migrated, restored, applied, again } = await rolledBack(
			async () => {
				const migrated = await everything();
				await client.query(AS_RESTORED);
				const restored = await everything();
				await client.query(body);
				const applied = await everything();
				await client.query(body);
				return { migrated, restored, applied, again: await everything() };
			},
		);

		// The restore really took everything away, so the comparison can fail.
		for (const table of Object.values(restored.catalog.tables)) {
			expect(table.privileges).toEqual([]);
		}
		expect(restored.catalog.columns).toEqual({});
		expect(restored.catalog.tables.user?.rls).toBe(false);
		expect(restored.catalog.tables.invite_code?.rls).toBe(false);
		expect(restored.keystore).not.toEqual(migrated.keystore);
		expect(restored.snapshot.defaults).not.toEqual(migrated.snapshot.defaults);

		// The file reproduces the migrated state, and the ratchet.
		expect(applied.snapshot).toEqual(migrated.snapshot);
		expect(applied.keystore).toEqual(migrated.keystore);
		expect(applied.publicUsage).toBe(true);
		const catalog: PrivilegeCatalog = applied.catalog;
		expect(catalog.tables).toEqual(expected.tables);
		expect(catalog.columns).toEqual(expected.columns);
		expect(catalog.sequences).toEqual(expected.sequences);
		expect(catalog.publicTables).toEqual([]);

		// Applying it again changes nothing.
		expect(again).toEqual(applied);
	}, 60_000);

	it("leaves the database as it found it", async () => {
		const { rows } = await client.query<{ rls: boolean }>(
			`SELECT relrowsecurity AS rls FROM pg_class WHERE oid = '"user"'::regclass`,
		);
		expect(rows[0]?.rls).toBe(true);
	});
});
