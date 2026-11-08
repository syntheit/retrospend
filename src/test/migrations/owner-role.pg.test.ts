// The app connects as retrospend_owner, a table owner that is not a superuser
// (A2, access hardening). What that has to mean, checked on the worker's own
// database, which the harness migrated as the owner exactly as a new install
// is (pg-global-setup.ts):
//   - the runtime connection holds no superuser power, and nothing that runs as
//     retrospend_app (RLS) can reach a superuser by RESET ROLE or SET ROLE;
//   - nothing in public or keystore is owned by anyone else;
//   - an install that older releases migrated as the superuser is handed over
//     completely, by one statement per object, and a second run does nothing.
//
// Nothing here creates a database (that stalls every other worker). The
// upgrade path is checked on the legacy database the global setup made, which
// only this file reads, and on the worker database inside a transaction that
// always ends in ROLLBACK.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { adminDb, superUrl, withSuperuser } from "~/test/pg-harness";
import {
	bootstrap,
	enforceOwnerRole,
	handover,
	handoverStatements,
	ownerProblems,
} from "../../../scripts/db-owner/index.mjs";
import { REPO_ROOT } from "../uiRules/paths";
import { readPrivilegeCatalog } from "./privilege-catalog";
import expected from "./retrospend-app-privileges.json";

async function connect(url: string) {
	const client = new Client({ connectionString: url });
	await client.connect();
	return client;
}

/** Every object in public or keystore that retrospend_owner does not own, extension members excepted. */
const FOREIGN_OWNED = `
	WITH owner AS (SELECT oid FROM pg_roles WHERE rolname = 'retrospend_owner'),
	     schemas AS (SELECT oid, nspname FROM pg_namespace WHERE nspname IN ('public', 'keystore'))
	SELECT 'schema ' || nspname AS object
	  FROM pg_namespace WHERE oid IN (SELECT oid FROM schemas)
	   AND nspowner <> (SELECT oid FROM owner)
	UNION ALL
	SELECT 'relation ' || c.oid::regclass || ' (' || c.relkind::text || ')'
	  FROM pg_class c WHERE c.relnamespace IN (SELECT oid FROM schemas)
	   AND c.relowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'routine ' || p.oid::regprocedure
	  FROM pg_proc p WHERE p.pronamespace IN (SELECT oid FROM schemas)
	   AND p.proowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'type ' || t.oid::regtype
	  FROM pg_type t WHERE t.typnamespace IN (SELECT oid FROM schemas)
	   AND t.typowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'collation ' || o.collname FROM pg_collation o
	 WHERE o.collnamespace IN (SELECT oid FROM schemas) AND o.collowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_collation'::regclass AND d.objid = o.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'conversion ' || o.conname FROM pg_conversion o
	 WHERE o.connamespace IN (SELECT oid FROM schemas) AND o.conowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_conversion'::regclass AND d.objid = o.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'operator ' || o.oprname FROM pg_operator o
	 WHERE o.oprnamespace IN (SELECT oid FROM schemas) AND o.oprowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_operator'::regclass AND d.objid = o.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'operator class ' || o.opcname FROM pg_opclass o
	 WHERE o.opcnamespace IN (SELECT oid FROM schemas) AND o.opcowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_opclass'::regclass AND d.objid = o.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'operator family ' || o.opfname FROM pg_opfamily o
	 WHERE o.opfnamespace IN (SELECT oid FROM schemas) AND o.opfowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_opfamily'::regclass AND d.objid = o.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'text search configuration ' || o.cfgname FROM pg_ts_config o
	 WHERE o.cfgnamespace IN (SELECT oid FROM schemas) AND o.cfgowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_ts_config'::regclass AND d.objid = o.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'text search dictionary ' || o.dictname FROM pg_ts_dict o
	 WHERE o.dictnamespace IN (SELECT oid FROM schemas) AND o.dictowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_ts_dict'::regclass AND d.objid = o.oid AND d.deptype = 'e')
	UNION ALL
	SELECT 'statistics ' || o.stxname FROM pg_statistic_ext o
	 WHERE o.stxnamespace IN (SELECT oid FROM schemas) AND o.stxowner <> (SELECT oid FROM owner)
	   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_statistic_ext'::regclass AND d.objid = o.oid AND d.deptype = 'e')
	ORDER BY 1`;

async function foreignOwned(client: Client): Promise<string[]> {
	const { rows } = await client.query<{ object: string }>(FOREIGN_OWNED);
	return rows.map((r) => r.object);
}

/** Runs a statement that cannot be in a transaction block, and returns the error it raised. */
async function failureOutsideTransaction(
	client: Client,
	sql: string,
): Promise<string | null> {
	try {
		await client.query(sql);
		return null;
	} catch (error) {
		return (error as Error).message;
	}
}

/** Runs `sql` in a transaction that is rolled back, and returns the error it raised. */
async function failureOf(client: Client, sql: string): Promise<string | null> {
	await client.query("BEGIN");
	try {
		await client.query(sql);
		return null;
	} catch (error) {
		return (error as Error).message;
	} finally {
		await client.query("ROLLBACK");
	}
}

describe("the runtime connection", () => {
	let client: Client;
	beforeAll(async () => {
		client = await connect(process.env.DATABASE_URL as string);
	});
	afterAll(async () => {
		await client.end();
	});

	it("is retrospend_owner, with no attribute that reaches beyond the database", async () => {
		const { rows } = await client.query(`
			SELECT current_user AS cu, session_user AS su, r.rolsuper, r.rolcreaterole,
			       r.rolcreatedb, r.rolreplication, r.rolbypassrls, r.rolcanlogin
			  FROM pg_roles r WHERE r.rolname = current_user`);
		expect(rows[0]).toEqual({
			cu: "retrospend_owner",
			su: "retrospend_owner",
			rolsuper: false,
			rolcreaterole: false,
			rolcreatedb: false,
			rolreplication: false,
			// Four tables are FORCE ROW LEVEL SECURITY and the global client and
			// pg_dump must still see every row of them, as they did as a superuser.
			rolbypassrls: true,
			rolcanlogin: true,
		});
		// The Prisma client the app uses is on the same role.
		const [row] = await adminDb.$queryRaw<
			{ cu: string; su: string }[]
		>`SELECT current_user AS cu, session_user AS su`;
		expect(row).toEqual({ cu: "retrospend_owner", su: "retrospend_owner" });
	});

	it("cannot become a superuser: SET ROLE and SET SESSION AUTHORIZATION fail", async () => {
		const { rows } = await client.query<{ name: string }>(
			"SELECT rolname AS name FROM pg_roles WHERE rolsuper",
		);
		expect(rows.length).toBeGreaterThan(0);
		for (const { name } of rows) {
			expect(await failureOf(client, `SET ROLE "${name}"`), name).toMatch(
				/permission denied to set role/,
			);
			expect(
				await failureOf(client, `SET SESSION AUTHORIZATION "${name}"`),
				name,
			).toMatch(/permission denied to set session authorization/);
		}
	});

	it("is a member of no superuser and of no role that reads files or runs programs", async () => {
		const { rows } = await client.query<{ name: string; member: boolean }>(`
			SELECT r.rolname AS name, pg_has_role(session_user, r.oid, 'MEMBER') AS member
			  FROM pg_roles r
			 WHERE r.rolsuper OR r.rolname IN (
			   'pg_execute_server_program', 'pg_read_server_files', 'pg_write_server_files',
			   'pg_read_all_data', 'pg_write_all_data')`);
		expect(rows.length).toBeGreaterThan(1);
		expect(rows.filter((r) => r.member).map((r) => r.name)).toEqual([]);
	});

	it("cannot run a program, read a server file, create or promote a role, or drop another database", async () => {
		const denied = /permission denied|must be superuser|must be owner/;
		expect(
			await failureOf(client, "COPY (SELECT 1) TO PROGRAM 'true'"),
		).toMatch(denied);
		expect(
			await failureOf(client, "SELECT pg_read_file('/etc/passwd')"),
		).toMatch(denied);
		expect(await failureOf(client, "CREATE ROLE a2_must_not_exist")).toMatch(
			denied,
		);
		expect(
			await failureOf(client, "ALTER ROLE retrospend_owner SUPERUSER"),
		).toMatch(denied);
		expect(
			await failureOutsideTransaction(client, "DROP DATABASE postgres"),
		).toMatch(denied);
		expect(
			await failureOutsideTransaction(
				client,
				"CREATE DATABASE a2_must_not_exist",
			),
		).toMatch(denied);
	});
});

describe("code that runs as retrospend_app (row-level security)", () => {
	it("reaches the owner by RESET ROLE, and no superuser from there", async () => {
		const userId = randomUUID();
		const inside = await userTransaction(adminDb, userId, async (tx) => {
			const [scoped] = await tx.$queryRaw<{ cu: string; su: string }[]>`
				SELECT current_user AS cu, session_user AS su`;
			await tx.$executeRaw`RESET ROLE`;
			const [reset] = await tx.$queryRaw<
				{ cu: string; su: boolean; bypass: boolean }[]
			>`SELECT current_user AS cu, r.rolsuper AS su, r.rolbypassrls AS bypass
			    FROM pg_roles r WHERE r.rolname = current_user`;
			return { scoped, reset };
		});
		expect(inside.scoped).toEqual({
			cu: "retrospend_app",
			su: "retrospend_owner",
		});
		expect(inside.reset).toEqual({
			cu: "retrospend_owner",
			su: false,
			bypass: true,
		});
	});

	it("cannot SET ROLE to a superuser, as itself or after RESET ROLE", async () => {
		const rows = await adminDb.$queryRaw<
			{ name: string }[]
		>`SELECT rolname AS name FROM pg_roles WHERE rolsuper`;
		expect(rows.length).toBeGreaterThan(0);
		for (const { name } of rows) {
			for (const reset of [false, true]) {
				await expect(
					userTransaction(adminDb, randomUUID(), async (tx) => {
						if (reset) await tx.$executeRaw`RESET ROLE`;
						await tx.$executeRawUnsafe(`SET ROLE "${name}"`);
					}),
				).rejects.toThrow(/permission denied to set role/);
			}
		}
	});

	it("is a member of no other role, and only the owner and superusers are members of it", async () => {
		const memberOf = await adminDb.$queryRaw<{ n: bigint }[]>`
			SELECT count(*) AS n FROM pg_auth_members
			 WHERE member = 'retrospend_app'::regrole`;
		expect(Number(memberOf[0]?.n)).toBe(0);
		const members = await adminDb.$queryRaw<{ name: string }[]>`
			SELECT DISTINCT m.rolname AS name FROM pg_auth_members am
			  JOIN pg_roles m ON m.oid = am.member
			 WHERE am.roleid = 'retrospend_app'::regrole AND NOT m.rolsuper
			 ORDER BY 1`;
		expect(members.map((m) => m.name)).toEqual(["retrospend_owner"]);
	});
});

describe("ownership", () => {
	it("leaves nothing in public or keystore to anyone but the owner", async () => {
		const client = await connect(process.env.DATABASE_URL as string);
		try {
			expect(await foreignOwned(client)).toEqual([]);
			// The exception is real: unaccent's functions belong to the superuser.
			const { rows } = await client.query<{ n: string }>(`
				SELECT count(*) AS n FROM pg_proc p
				 WHERE p.proowner <> 'retrospend_owner'::regrole
				   AND p.pronamespace = 'public'::regnamespace
				   AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`);
			expect(Number(rows[0]?.n)).toBeGreaterThan(0);
		} finally {
			await client.end();
		}
	});

	it("is done for every object the migrations created: current_user was the owner while they ran", () => {
		// The template was migrated by `prisma migrate deploy` signed in as
		// retrospend_owner. A second bootstrap after that handed over nothing.
		expect(inject("pgFresh").handedOverAfterMigrate).toBe(0);
	});

	it("leaves the app role exactly the privileges the ratchet lists", async () => {
		const client = await connect(process.env.DATABASE_URL as string);
		try {
			const catalog = await readPrivilegeCatalog(client);
			// The migrations alone leave retrospend_app exactly what the ratchet says.
			expect(catalog.tables).toEqual(expected.tables);
		} finally {
			await client.end();
		}
	});
});

describe("prisma/bootstrap/owner-role.sql", () => {
	// The file has its own BEGIN and COMMIT; stripped so that COMMIT cannot end
	// the test's transaction, which always rolls back.
	const sql = readFileSync(
		join(REPO_ROOT, "prisma/bootstrap/owner-role.sql"),
		"utf8",
	).replace(/^(BEGIN|COMMIT);$/gm, "");

	const inRolledBack = (steps: (client: Client) => Promise<void>) =>
		withSuperuser(async (client) => {
			await client.query("BEGIN");
			try {
				await steps(client);
			} finally {
				await client.query("ROLLBACK");
			}
		});

	it("gives the owner CREATE on the database, and gives it back if it was taken away", async () => {
		// Permanent: CREATE SCHEMA IF NOT EXISTS (the first migration, and
		// keystore in a later one) is checked against it before the existence
		// check. It lets the owner create schemas in its own database, nothing more.
		await inRolledBack(async (client) => {
			const canCreate = async () =>
				(
					await client.query<{ can: boolean }>(
						"SELECT has_database_privilege('retrospend_owner', current_database(), 'CREATE') AS can",
					)
				).rows[0]?.can;
			await client.query(sql);
			expect(await canCreate()).toBe(true);
			const { rows } = await client.query<{ name: string }>(
				"SELECT quote_ident(current_database()) AS name",
			);
			await client.query(
				`REVOKE CREATE ON DATABASE ${rows[0]?.name} FROM retrospend_owner`,
			);
			expect(await canCreate()).toBe(false);
			await client.query(sql);
			expect(await canCreate()).toBe(true);
		});
	});

	it("reads and calls nothing of the owner's: an owner-made view in place of _prisma_migrations does not run", async () => {
		// The attack: the owner owns _prisma_migrations, so it can replace it with
		// a view whose condition calls a function. A superuser that reads the
		// table runs that function with superuser rights (here it grants the
		// owner pg_execute_server_program, which means COPY ... TO PROGRAM).
		await inRolledBack(async (client) => {
			const holdsProgramRole = async () =>
				(
					await client.query<{ held: boolean }>(
						"SELECT pg_has_role('retrospend_owner', 'pg_execute_server_program', 'MEMBER') AS held",
					)
				).rows[0]?.held;
			await client.query("SET LOCAL ROLE retrospend_owner");
			await client.query(
				"ALTER TABLE public._prisma_migrations RENAME TO a2_real_migrations",
			);
			await client.query(`
				CREATE FUNCTION public.a2_evil() RETURNS boolean LANGUAGE plpgsql AS $f$
				BEGIN
				  GRANT pg_execute_server_program TO retrospend_owner;
				  RETURN true;
				END $f$`);
			await client.query(
				"CREATE VIEW public._prisma_migrations AS SELECT now() AS finished_at WHERE public.a2_evil()",
			);
			await client.query("RESET ROLE");
			expect(await holdsProgramRole()).toBe(false);

			// The bootstrap, the handover listing and the handover itself.
			await client.query(sql);
			for (const statement of await handoverStatements(client)) {
				await client.query(statement);
			}
			expect(await holdsProgramRole()).toBe(false);

			// The control: a superuser read of the view does run the owner's function,
			// so the checks above would fail if the bootstrap did that.
			await client.query("SELECT * FROM public._prisma_migrations");
			expect(await holdsProgramRole()).toBe(true);
			expect(await ownerProblems(client)).toEqual([
				"owner holds pg_execute_server_program (directly or through another role)",
				"owner is a member of pg_execute_server_program",
			]);

			// And the check that follows the bootstrap removes it and refuses to start.
			const warnings: string[] = [];
			await expect(
				enforceOwnerRole(client, (message) => warnings.push(message)),
			).rejects.toThrow(/removed, start again/);
			expect(warnings[0]).toMatch(/^WARNING: .*pg_execute_server_program/);
			expect(await holdsProgramRole()).toBe(false);
			expect(await ownerProblems(client)).toEqual([]);
		});
	});

	it("refuses a role that holds a pg_ role, a role-creating role or another member, however it got there", async () => {
		await inRolledBack(async (client) => {
			await client.query("CREATE ROLE a2_probe_creator CREATEROLE");
			await client.query("CREATE ROLE a2_probe_relay");
			await client.query("GRANT pg_read_server_files TO a2_probe_relay");
			await client.query("GRANT a2_probe_relay TO retrospend_owner");
			await client.query("GRANT a2_probe_creator TO retrospend_owner");
			await client.query("GRANT pg_read_all_data TO retrospend_app");
			expect(await ownerProblems(client)).toEqual([
				"owner holds a2_probe_creator (directly or through another role)",
				// Through retrospend_app, which must be a member of nothing.
				"owner holds pg_read_all_data (directly or through another role)",
				"owner holds pg_read_server_files (directly or through another role)",
				"owner is a member of a2_probe_creator",
				"owner is a member of a2_probe_relay",
				"retrospend_app is a member of pg_read_all_data",
			]);
			await expect(enforceOwnerRole(client, () => undefined)).rejects.toThrow(
				/removed, start again/,
			);
			expect(await ownerProblems(client)).toEqual([]);
			// What the app role was allowed stays.
			const { rows } = await client.query<{ ok: boolean }>(
				"SELECT pg_has_role('retrospend_owner', 'retrospend_app', 'MEMBER') AS ok",
			);
			expect(rows[0]?.ok).toBe(true);
		});
	});

	it("passes on a role that is as it should be", async () => {
		await withSuperuser(async (client) => {
			expect(await ownerProblems(client)).toEqual([]);
			await expect(
				enforceOwnerRole(client, () => undefined),
			).resolves.toBeUndefined();
		});
	});

	it("puts a drifted owner role back: no extra power, ADMIN OPTION on the app role", async () => {
		await inRolledBack(async (client) => {
			await client.query(
				"ALTER ROLE retrospend_owner CREATEROLE CREATEDB REPLICATION NOBYPASSRLS",
			);
			await client.query(
				"REVOKE ADMIN OPTION FOR retrospend_app FROM retrospend_owner CASCADE",
			);
			await client.query(sql);
			const { rows } = await client.query(`
				SELECT r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
				       r.rolbypassrls, r.rolcanlogin,
				       EXISTS (SELECT 1 FROM pg_auth_members
				                WHERE roleid = 'retrospend_app'::regrole AND member = r.oid
				                  AND admin_option) AS admin
				  FROM pg_roles r WHERE r.rolname = 'retrospend_owner'`);
			expect(rows[0]).toEqual({
				rolsuper: false,
				rolcreaterole: false,
				rolcreatedb: false,
				rolreplication: false,
				rolbypassrls: true,
				rolcanlogin: true,
				admin: true,
			});
		});
	});

	it("pins its search_path and keeps PUBLIC from creating objects in public", () => {
		expect(sql).toContain("SET LOCAL search_path = pg_catalog, pg_temp");
		expect(sql).toContain("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
	});
});

describe("the handover from an install the superuser migrated", () => {
	it("finds every kind of object, hands them over, and a second run finds none", async () => {
		const admin = await connect(superUrl());
		try {
			await admin.query("BEGIN");
			await admin.query(`
				ALTER TABLE public.expense OWNER TO CURRENT_USER;
				ALTER TABLE public.api_event OWNER TO CURRENT_USER;
				ALTER SCHEMA keystore OWNER TO CURRENT_USER;
				ALTER SCHEMA public OWNER TO CURRENT_USER;
				CREATE SEQUENCE public.a2_free_seq;
				CREATE VIEW public.a2_view AS SELECT 1 AS one;
				CREATE TYPE public.a2_mood AS ENUM ('ok');
				CREATE DOMAIN public.a2_dom AS integer;
				CREATE PROCEDURE public.a2_proc() LANGUAGE sql AS 'SELECT 1';
				CREATE AGGREGATE public.a2_agg(integer) (sfunc = int4pl, stype = integer, initcond = 0);
				CREATE FUNCTION public.a2_fn(a integer, b text) RETURNS integer LANGUAGE sql AS 'SELECT 1';`);
			const legacy = await foreignOwned(admin);
			expect(legacy).toEqual(
				expect.arrayContaining([
					"schema keystore",
					"schema public",
					"relation expense (r)",
					"relation api_event (r)",
					"relation a2_free_seq (S)",
					"relation a2_view (v)",
					"type a2_mood",
					"type a2_dom",
					"routine a2_proc()",
					"routine a2_agg(integer)",
					"routine a2_fn(integer,text)",
				]),
			);

			const statements = await handoverStatements(admin);
			const joined = statements.join("\n");
			for (const fragment of [
				"ALTER SCHEMA keystore OWNER TO retrospend_owner",
				"ALTER SCHEMA public OWNER TO retrospend_owner",
				"ALTER TABLE public.expense OWNER TO retrospend_owner",
				"ALTER SEQUENCE public.a2_free_seq OWNER TO retrospend_owner",
				"ALTER VIEW public.a2_view OWNER TO retrospend_owner",
				"ALTER TYPE public.a2_mood OWNER TO retrospend_owner",
				"ALTER DOMAIN public.a2_dom OWNER TO retrospend_owner",
				"ALTER PROCEDURE public.a2_proc() OWNER TO retrospend_owner",
				"ALTER AGGREGATE public.a2_agg(integer) OWNER TO retrospend_owner",
				"ALTER FUNCTION public.a2_fn(a integer, b text) OWNER TO retrospend_owner",
			]) {
				expect(joined, fragment).toContain(fragment);
			}
			// A sequence a column made follows its table: no statement of its own.
			expect(joined).not.toMatch(/ALTER SEQUENCE public\.api_event_seq_seq/);
			// unaccent's members stay with the superuser.
			expect(joined).not.toMatch(/unaccent/);

			for (const statement of statements) await admin.query(statement);
			expect(await foreignOwned(admin)).toEqual([]);
			expect(await handoverStatements(admin)).toEqual([]);
		} finally {
			await admin.query("ROLLBACK");
			await admin.end();
		}
	});
});

describe("an install that older releases migrated as the superuser", () => {
	const legacy = inject("pgLegacy");
	let owner: Client;
	let admin: Client;
	beforeAll(async () => {
		owner = await connect(legacy.ownerUrl);
		admin = await connect(legacy.superUrl);
	});
	afterAll(async () => {
		await owner.end();
		await admin.end();
	});

	/** `prisma` as the owner against the legacy database, quietly. */
	const prisma = (args: string[]) =>
		execFileSync("pnpm", ["exec", "prisma", ...args], {
			cwd: REPO_ROOT,
			env: { ...process.env, DATABASE_URL: legacy.ownerUrl },
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});

	it("was handed over whole at its first start", async () => {
		// Every table, sequence, function and type of ~100 migrations: far more
		// than one kind of object.
		expect(legacy.handedOver).toBeGreaterThan(100);
		expect(await foreignOwned(owner)).toEqual([]);
	});

	it("changes nothing on the next start", async () => {
		expect(await handover(admin)).toBe(0);
		const again = await bootstrap(legacy.superUrl);
		expect(again).toMatchObject({ status: "switched", changedObjects: 0 });
	});

	it("migrates and applies the grants file as the owner, and the app role ends up as the ratchet says", async () => {
		const migrate = prisma(["migrate", "deploy"]);
		expect(migrate).toMatch(/No pending migrations/);
		prisma(["db", "execute", "--file", "prisma/grants/app-role.sql"]);
		const catalog = await readPrivilegeCatalog(owner);
		expect(catalog.tables).toEqual(expected.tables);
		expect(catalog.columns).toEqual(expected.columns);
		expect(catalog.sequences).toEqual(expected.sequences);
		// The grants file's default privileges now belong to the owner, which
		// creates every later object.
		const { rows } = await owner.query<{ n: string }>(`
			SELECT count(*) AS n FROM pg_default_acl
			 WHERE defaclrole = 'retrospend_owner'::regrole AND defaclobjtype = 'f'`);
		expect(Number(rows[0]?.n)).toBeGreaterThan(0);
	}, 120_000);

	it("runs SQL that prisma applies as retrospend_owner, which is what a migration is", async () => {
		const dir = mkdtempSync(join(tmpdir(), "a2-probe-"));
		try {
			const file = join(dir, "probe.sql");
			writeFileSync(
				file,
				`CREATE TABLE public.a2_probe AS SELECT current_user::text AS who, session_user::text AS su;
				 CREATE FUNCTION public.a2_probe_fn() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT current_user::text';`,
			);
			prisma(["db", "execute", "--file", file]);
			const { rows } = await owner.query(`
				SELECT p.who, p.su, pg_get_userbyid(c.relowner) AS table_owner,
				       pg_get_userbyid(f.proowner) AS function_owner, public.a2_probe_fn() AS definer_runs_as
				  FROM public.a2_probe p, pg_class c, pg_proc f
				 WHERE c.oid = 'public.a2_probe'::regclass AND f.proname = 'a2_probe_fn'`);
			expect(rows[0]).toEqual({
				who: "retrospend_owner",
				su: "retrospend_owner",
				table_owner: "retrospend_owner",
				function_owner: "retrospend_owner",
				definer_runs_as: "retrospend_owner",
			});
		} finally {
			await owner.query(
				"DROP TABLE IF EXISTS public.a2_probe; DROP FUNCTION IF EXISTS public.a2_probe_fn()",
			);
			rmSync(dir, { recursive: true, force: true });
		}
	}, 60_000);
});

describe("an install from before the keystore migration", () => {
	const old = inject("pgOld");
	let owner: Client;
	beforeAll(async () => {
		owner = await connect(old.ownerUrl);
	});
	afterAll(async () => {
		await owner.end();
	});

	const prisma = (args: string[]) =>
		execFileSync("pnpm", ["exec", "prisma", ...args], {
			cwd: REPO_ROOT,
			env: { ...process.env, DATABASE_URL: old.ownerUrl },
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});

	it("was migrated as the superuser only up to the cutoff, and the bootstrap made the keystore schema for the owner", async () => {
		const { rows: later } = await owner.query<{ n: string }>(
			"SELECT count(*) AS n FROM _prisma_migrations WHERE migration_name >= $1",
			[old.cutoff],
		);
		expect(Number(later[0]?.n)).toBe(0);
		const { rows } = await owner.query<{ owner: string; tables: string }>(`
			SELECT pg_get_userbyid(n.nspowner) AS owner,
			       (SELECT count(*) FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind = 'r') AS tables
			  FROM pg_namespace n WHERE n.nspname = 'keystore'`);
		expect(rows[0]).toEqual({ owner: "retrospend_owner", tables: "0" });
		expect(await foreignOwned(owner)).toEqual([]);
	});

	it("applies the pending migrations as the owner, the keystore one included, and the grants file after it", async () => {
		const migrate = prisma(["migrate", "deploy"]);
		expect(migrate).toContain(old.cutoff);
		expect(migrate).toContain("20261109600000_least_privilege");
		expect(migrate).toMatch(/successfully applied/);
		prisma(["db", "execute", "--file", "prisma/grants/app-role.sql"]);

		const catalog = await readPrivilegeCatalog(owner);
		expect(catalog.tables).toEqual(expected.tables);
		expect(catalog.columns).toEqual(expected.columns);
		expect(catalog.sequences).toEqual(expected.sequences);
		expect(await foreignOwned(owner)).toEqual([]);
		// The keystore migration ran as the owner inside the schema the bootstrap made.
		const { rows } = await owner.query<{ owner: string }>(
			`SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'keystore.user_data_key'::regclass`,
		);
		expect(rows[0]?.owner).toBe("retrospend_owner");
		// The app role reaches its key through the two functions only.
		const { rows: fns } = await owner.query<{ name: string }>(`
			SELECT p.proname AS name FROM pg_proc p
			 WHERE p.pronamespace = 'keystore'::regnamespace
			   AND has_function_privilege('retrospend_app', p.oid, 'EXECUTE')
			 ORDER BY 1`);
		expect(fns.map((f) => f.name)).toEqual([
			"create_first_data_key",
			"current_user_data_keys",
		]);
		expect(await ownerProblems(owner)).toEqual([]);
	}, 120_000);
});
