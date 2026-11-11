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
import { describe, expect, it } from "vitest";
import {
	inRolledBackTransaction,
	readSqlWithoutTransaction,
} from "~/test/rolled-back-sql";
import { REPO_ROOT } from "../uiRules/paths";
import lists from "./definer-functions.json";
import {
	type PrivilegeCatalog,
	readCatalogSnapshot,
	readDefaultAcls,
	readKeystoreAccess,
	readPrivilegeCatalog,
} from "./privilege-catalog";
import expected from "./retrospend-app-privileges.json";

const GRANTS_FILE = "prisma/grants/app-role.sql";
const file = readFileSync(join(REPO_ROOT, GRANTS_FILE), "utf8");

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
	REVOKE EXECUTE ON FUNCTION keystore."instance_text_keys"(), keystore."create_first_instance_key"(text, bigint) FROM retrospend_app;
	GRANT EXECUTE ON FUNCTION keystore."instance_text_keys"(), keystore."create_first_instance_key"(text, bigint), keystore."require_instance_actor"() TO PUBLIC;
	ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO retrospend_app;
	ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO retrospend_app;
	REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM retrospend_app;
	GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC;
	ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
`;

type FunctionState = {
	name: string;
	definer: boolean;
	publicExecute: boolean;
	appExecute: boolean;
	/** The whole ACL, as a restore or the file leaves it. */
	acl: string;
};

/** Every function in public that is not an extension's, with who may execute it. */
async function functionStates(client: Client): Promise<FunctionState[]> {
	const { rows } = await client.query<FunctionState>(`
		SELECT p.oid::regprocedure::text AS name,
		       p.prosecdef AS definer,
		       EXISTS (
		         SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
		         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
		       ) AS "publicExecute",
		       has_function_privilege('retrospend_app', p.oid, 'EXECUTE') AS "appExecute",
		       (SELECT string_agg(
		                 CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END
		                   || ':' || a.privilege_type,
		                 ',' ORDER BY a.grantee, a.privilege_type)
		        FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a) AS acl
		FROM pg_proc p
		WHERE p.pronamespace = 'public'::regnamespace
		  AND p.prokind IN ('f', 'p')
		  AND NOT EXISTS (
		    SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
		  )`);
	return rows.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

const bareName = (sig: string) => sig.replace(/\(.*$/, "");

async function everything(client: Client) {
	const owner = (
		await client.query<{ owner: string }>("SELECT current_user::text AS owner")
	).rows[0]?.owner as string;
	return {
		functions: await functionStates(client),
		functionDefaults: (await readDefaultAcls(client))
			.filter((d) => d.kind === "f")
			.map((d) =>
				`${d.role} ${d.schema} ${d.entries.join(",")}`.replaceAll(
					owner,
					"<owner>",
				),
			),
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
		const body = readSqlWithoutTransaction(GRANTS_FILE);
		type State = Awaited<ReturnType<typeof everything>>;
		let migrated: State | undefined;
		let restored: State | undefined;
		let applied: State | undefined;
		let again: State | undefined;
		await inRolledBackTransaction(async (client) => {
			migrated = await everything(client);
			await client.query(AS_RESTORED);
			restored = await everything(client);
			await client.query(body);
			applied = await everything(client);
			await client.query(body);
			again = await everything(client);
		});
		if (!migrated || !restored || !applied || !again)
			throw new Error("no capture");

		// The restore really took everything away, so the comparison can fail.
		for (const table of Object.values(restored.catalog.tables)) {
			expect(table.privileges).toEqual([]);
		}
		expect(restored.catalog.columns).toEqual({});
		expect(restored.catalog.tables.user?.rls).toBe(false);
		expect(restored.catalog.tables.invite_code?.rls).toBe(false);
		expect(restored.keystore).not.toEqual(migrated.keystore);
		expect(restored.snapshot.defaults).not.toEqual(migrated.snapshot.defaults);

		// The restore left every function executable by PUBLIC.
		expect(restored.functions.some((f) => f.publicExecute)).toBe(true);
		expect(restored.functionDefaults).not.toEqual(migrated.functionDefaults);

		// The file reproduces the migrated state, and the ratchet.
		expect(applied.snapshot).toEqual(migrated.snapshot);
		expect(applied.functions).toEqual(migrated.functions);
		expect(applied.functionDefaults).toEqual(migrated.functionDefaults);
		expect(applied.keystore).toEqual(migrated.keystore);
		expect(applied.publicUsage).toBe(true);
		const catalog: PrivilegeCatalog = applied.catalog;
		expect(catalog.tables).toEqual(expected.tables);
		expect(catalog.columns).toEqual(expected.columns);
		expect(catalog.sequences).toEqual(expected.sequences);
		expect(catalog.publicTables).toEqual([]);

		// ... and it meets the definer hygiene expectations (definer-functions.json):
		// no PUBLIC execute anywhere, and retrospend_app executes exactly the
		// listed definer and invoker functions.
		expect(applied.functions.filter((f) => f.publicExecute)).toEqual([]);
		const appliedFunctions = applied.functions;
		const appRuns = (definer: boolean) =>
			appliedFunctions
				.filter((f) => f.definer === definer && f.appExecute)
				.map((f) => bareName(f.name))
				.sort();
		expect(appRuns(true)).toEqual([...lists.appExecutable].sort());
		expect(appRuns(false)).toEqual([...lists.invokerAppExecutable].sort());
		expect(
			applied.functions
				.filter((f) => f.definer && !f.appExecute)
				.map((f) => bareName(f.name))
				.sort(),
		).toEqual([...lists.ownerOnly].sort());

		// Applying it again changes nothing.
		expect(again).toEqual(applied);
	}, 60_000);

	it("sets a lock timeout at the top of its transaction", () => {
		const sql = file.replace(/--[^\n]*/g, "");
		expect(sql.indexOf("BEGIN;")).toBeLessThan(
			sql.indexOf("SET LOCAL lock_timeout = '10s';"),
		);
		expect(sql.indexOf("SET LOCAL lock_timeout")).toBeLessThan(
			sql.indexOf("GRANT"),
		);
	});

	it("takes no lock that waits behind a reader when the policies are in place", async () => {
		// pg_dump holds ACCESS SHARE on every table for the whole dump. Enabling
		// row-level security or creating a policy needs ACCESS EXCLUSIVE and would
		// wait behind it, so a start during a backup would hang.
		const body = readSqlWithoutTransaction(GRANTS_FILE).replace(
			"SET LOCAL lock_timeout = '10s';",
			"SET LOCAL lock_timeout = '1s';",
		);
		expect(body).toContain("lock_timeout = '1s'");
		const dump = new Client({ connectionString: process.env.DATABASE_URL });
		await dump.connect();
		let controlWaited = false;
		try {
			await dump.query("BEGIN");
			await dump.query('LOCK TABLE "user", "invite_code" IN ACCESS SHARE MODE');
			await inRolledBackTransaction(async (client) => {
				await client.query(body);
				await client.query("SAVEPOINT control");
				// The same lock the old statements needed does wait.
				await client
					.query('ALTER TABLE "user" DISABLE ROW LEVEL SECURITY')
					.catch((error: Error) => {
						controlWaited = /lock timeout/.test(error.message);
					});
			});
		} finally {
			await dump.query("ROLLBACK");
			await dump.end();
		}
		expect(controlWaited).toBe(true);
	}, 30_000);

	it("recreates a policy that is missing or different, and the flag when it is off", async () => {
		const body = readSqlWithoutTransaction(GRANTS_FILE);
		let before: Awaited<ReturnType<typeof readCatalogSnapshot>> | undefined;
		let broken: Awaited<ReturnType<typeof readCatalogSnapshot>> | undefined;
		let after: Awaited<ReturnType<typeof readCatalogSnapshot>> | undefined;
		await inRolledBackTransaction(async (client) => {
			before = await readCatalogSnapshot(client);
			await client.query(`
				DROP POLICY user_update_own ON "user";
				ALTER POLICY invite_code_own ON "invite_code" USING (true);
				ALTER POLICY user_select_all ON "user" TO PUBLIC;
				ALTER TABLE "invite_code" DISABLE ROW LEVEL SECURITY`);
			broken = await readCatalogSnapshot(client);
			await client.query(body);
			after = await readCatalogSnapshot(client);
		});
		if (!before || !broken || !after) throw new Error("no capture");
		expect(broken.policies).not.toEqual(before.policies);
		expect(broken.security).not.toEqual(before.security);
		expect(after.policies).toEqual(before.policies);
		expect(after.security).toEqual(before.security);
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
