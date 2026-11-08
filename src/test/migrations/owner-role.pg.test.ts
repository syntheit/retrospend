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
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { adminDb, superUrl, withSuperuser } from "~/test/pg-harness";
import { makeScratchProject } from "~/test/scratch-project";
import {
	applyGrants,
	bootstrap,
	enforceOwnerRole,
	handover,
	handoverStatements,
	migrateWithRecovery,
	neverHandedOver,
	ownerProblems,
	prepare,
} from "../../../scripts/db-owner/index.mjs";
import { REPO_ROOT } from "../uiRules/paths";
import { readPrivilegeCatalog } from "./privilege-catalog";
import expected from "./retrospend-app-privileges.json";

async function connect(url: string) {
	const client = new Client({ connectionString: url });
	await client.connect();
	return client;
}

/**
 * Whether the owner holds CREATE on the database `superUrl` names, asked on a
 * connection of its own as the superuser (so it can be asked mid-migration).
 */
async function ownerCanCreateIn(superUrl: string): Promise<boolean> {
	const client = await connect(superUrl);
	try {
		const { rows } = await client.query<{ can: boolean }>(
			"SELECT has_database_privilege('retrospend_owner', current_database(), 'CREATE') AS can",
		);
		return rows[0]?.can === true;
	} finally {
		await client.end();
	}
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
		expect(await failureOf(client, "CREATE SCHEMA a2_must_not_exist")).toMatch(
			denied,
		);
		expect(
			await failureOf(client, "CREATE EXTENSION pgcrypto WITH SCHEMA public"),
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

	it("takes CREATE on the database away from the owner if it holds it", async () => {
		// The owner holds it only while the migrations run (prepare). With it the
		// owner could CREATE EXTENSION a trusted extension into a schema it
		// controls, and the install script would run as the superuser.
		await inRolledBack(async (client) => {
			const canCreate = async () =>
				(
					await client.query<{ can: boolean }>(
						"SELECT has_database_privilege('retrospend_owner', current_database(), 'CREATE') AS can",
					)
				).rows[0]?.can;
			expect(await canCreate()).toBe(false);
			const { rows } = await client.query<{ name: string }>(
				"SELECT quote_ident(current_database()) AS name",
			);
			// A crash between the grant and the revoke of a start leaves this.
			await client.query(
				`GRANT CREATE ON DATABASE ${rows[0]?.name} TO retrospend_owner`,
			);
			expect(await canCreate()).toBe(true);
			expect(await ownerProblems(client)).toContain(
				"owner can create schemas in the database",
			);
			await client.query(sql);
			expect(await canCreate()).toBe(false);
			expect(await ownerProblems(client)).toEqual([]);
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

	it("is not a new install, and a later start never gives the owner CREATE", async () => {
		expect(await neverHandedOver(admin)).toBe(false);
		let during: boolean | undefined;
		const result = await bootstrap(legacy.superUrl, {
			whileOwnerMayCreate: async () => {
				during = await ownerCanCreateIn(legacy.superUrl);
			},
		});
		expect(result.status).toBe("switched");
		expect(during).toBe(false);
	});
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

	it("was migrated as the superuser only up to the cutoff, and the bootstrap made the keystore schema for the owner", async () => {
		const { rows: later } = await owner.query<{ n: string }>(
			"SELECT count(*) AS n FROM _prisma_migrations WHERE migration_name >= $1",
			[old.cutoff],
		);
		expect(Number(later[0]?.n)).toBe(0);
		// Really an old install: every migration before the cutoff was applied
		// (a project that found no migration would leave this table empty).
		const shipped = readdirSync(join(REPO_ROOT, "prisma/migrations"), {
			withFileTypes: true,
		}).filter((entry) => entry.isDirectory() && entry.name < old.cutoff);
		const { rows: done } = await owner.query<{ n: string }>(
			"SELECT count(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL",
		);
		expect(shipped.length).toBeGreaterThan(60);
		expect(Number(done[0]?.n)).toBe(shipped.length);
		const { rows } = await owner.query<{ owner: string; tables: string }>(`
			SELECT pg_get_userbyid(n.nspowner) AS owner,
			       (SELECT count(*) FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind = 'r') AS tables
			  FROM pg_namespace n WHERE n.nspname = 'keystore'`);
		expect(rows[0]).toEqual({ owner: "retrospend_owner", tables: "0" });
		expect(await foreignOwned(owner)).toEqual([]);
	});

	it("applies the pending migrations as the owner without database CREATE, the keystore one included, and the grants file after it", async () => {
		// A 0.4.x install is not a new one, so the owner is never given CREATE;
		// the keystore migration says CREATE SCHEMA only when the schema is
		// missing, and the bootstrap made it.
		const admin = await connect(old.superUrl);
		try {
			expect(await neverHandedOver(admin)).toBe(false);
		} finally {
			await admin.end();
		}

		// The attack: the owner plants code in an object the migrations touch (a
		// trigger on _prisma_migrations, which Prisma writes a row to for every
		// migration it applies). It runs as the owner during the migrations; with
		// CREATE on the database it could install a trusted extension (hstore)
		// into a schema it made, and the extension's install script would run as
		// the superuser. The hook swallows its errors, as an attacker's would, and
		// logs them, which shows that it ran and was refused.
		await owner.query(`
			CREATE TABLE public.a2_hook_log (note text);
			CREATE FUNCTION public.a2_hook() RETURNS trigger LANGUAGE plpgsql AS $f$
			BEGIN
			  BEGIN
			    CREATE SCHEMA a2_trap;
			    CREATE EXTENSION hstore WITH SCHEMA a2_trap;
			  EXCEPTION WHEN OTHERS THEN
			    INSERT INTO public.a2_hook_log VALUES (SQLERRM);
			  END;
			  RETURN NEW;
			END $f$;
			CREATE TRIGGER a2_hook BEFORE INSERT ON public._prisma_migrations
			  FOR EACH ROW EXECUTE FUNCTION public.a2_hook()`);

		let during: boolean | undefined;
		const result = await bootstrap(old.superUrl, {
			whileOwnerMayCreate: async (url) => {
				during = await ownerCanCreateIn(old.superUrl);
				await migrateWithRecovery(url, { log: () => undefined });
			},
		});
		expect(result.status).toBe("switched");
		expect(during).toBe(false);

		const { rows: hook } = await owner.query<{ note: string }>(
			"SELECT note FROM public.a2_hook_log",
		);
		expect(hook.length).toBeGreaterThan(0);
		expect(hook.every((r) => /permission denied/.test(r.note))).toBe(true);
		const { rows: trap } = await owner.query<{
			schemas: string;
			extensions: string;
		}>(`
			SELECT (SELECT count(*) FROM pg_namespace WHERE nspname = 'a2_trap') AS schemas,
			       (SELECT count(*) FROM pg_extension WHERE extname = 'hstore') AS extensions`);
		expect(trap[0]).toEqual({ schemas: "0", extensions: "0" });
		await owner.query(`
			DROP TRIGGER a2_hook ON public._prisma_migrations;
			DROP FUNCTION public.a2_hook();
			DROP TABLE public.a2_hook_log`);

		await applyGrants((result as { ownerUrl: string }).ownerUrl);

		const { rows: ran } = await owner.query<{ name: string }>(
			"SELECT migration_name AS name FROM _prisma_migrations WHERE migration_name >= $1 AND finished_at IS NOT NULL",
			[old.cutoff],
		);
		expect(ran.map((r) => r.name)).toEqual(
			expect.arrayContaining([old.cutoff, "20261109100000_keystore"]),
		);

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
		expect(await ownerCanCreateIn(old.superUrl)).toBe(false);
	}, 180_000);
});

describe("the migration window on a brand-new install", () => {
	const scratch = inject("pgScratch");
	const scratch2 = inject("pgScratch2");
	const scratch3 = inject("pgScratch3");
	const quiet = { log: () => undefined, warn: () => undefined };
	/** A migration that needs CREATE on the database, as the first one and the keystore one did. */
	const window = (name: string, tag: string) => ({
		name,
		sql: `CREATE SCHEMA IF NOT EXISTS "public";
			CREATE SCHEMA IF NOT EXISTS keystore;
			CREATE SCHEMA a2_${tag}_schema;
			CREATE TABLE a2_${tag}_schema.probe (id integer);`,
	});
	/** What a retry can apply on an install that is no longer new: nothing needs CREATE. */
	const fixedSql = "CREATE TABLE public.a2_fixed (id integer);";

	it("is recognized from the catalogs, and gives the owner CREATE for the migrations only", async () => {
		const owner = await connect(scratch.ownerUrl);
		const admin = await connect(scratch.superUrl);
		try {
			expect(await neverHandedOver(admin)).toBe(true);
			// Outside the window the owner cannot, even for a schema that exists:
			// Postgres checks CREATE before IF NOT EXISTS.
			expect(await ownerCanCreateIn(scratch.superUrl)).toBe(false);
			expect(
				await failureOf(owner, 'CREATE SCHEMA IF NOT EXISTS "public"'),
			).toMatch(/permission denied for database/);

			const project = makeScratchProject({
				extra: [window("20300101000000_first", "first")],
			});
			try {
				await prepare(scratch.superUrl, { root: project.dir, ...quiet });
			} finally {
				project.cleanup();
			}
			// The migrations created a schema, which needs CREATE: it was there.
			const { rows } = await owner.query<{ owner: string }>(
				"SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'a2_first_schema'",
			);
			expect(rows[0]?.owner).toBe("retrospend_owner");
			expect(await ownerCanCreateIn(scratch.superUrl)).toBe(false);
			expect(await ownerProblems(owner)).toEqual([]);
		} finally {
			await owner.end();
			await admin.end();
		}
	}, 120_000);

	it("is over after the first start: a pending migration that needs CREATE then fails", async () => {
		const owner = await connect(scratch.ownerUrl);
		const admin = await connect(scratch.superUrl);
		try {
			expect(await neverHandedOver(admin)).toBe(false);
			const project = makeScratchProject({
				extra: [
					window("20300101000000_first", "first"),
					{
						name: "20300102000000_needs_create",
						sql: "CREATE SCHEMA a2_needs_create;",
					},
				],
			});
			try {
				await expect(
					prepare(scratch.superUrl, { root: project.dir, ...quiet }),
				).rejects.toThrow(/Migration failed/);
			} finally {
				project.cleanup();
			}
			expect(await ownerCanCreateIn(scratch.superUrl)).toBe(false);
			const { rows } = await owner.query<{ n: string }>(
				"SELECT count(*) AS n FROM pg_namespace WHERE nspname = 'a2_needs_create'",
			);
			expect(rows[0]?.n).toBe("0");
		} finally {
			await owner.end();
			await admin.end();
		}
	}, 120_000);

	it("takes CREATE back when a later migration fails, and the P3009 recovery then applies the fixed one without it", async () => {
		const owner = await connect(scratch2.ownerUrl);
		const admin = await connect(scratch2.superUrl);
		const good = window("20300101000000_second", "second");
		const bad = { name: "20300102000000_breaks", sql: "SELECT 1 / 0;" };
		const project = makeScratchProject({ extra: [good, bad] });
		try {
			expect(await neverHandedOver(admin)).toBe(true);
			await expect(
				prepare(scratch2.superUrl, { root: project.dir, ...quiet }),
			).rejects.toThrow(/Migration failed/);
			// Revoked although the migration failed.
			expect(await ownerCanCreateIn(scratch2.superUrl)).toBe(false);
			expect(await ownerProblems(owner)).toEqual([]);
			// The install has been through a first start: not new any more.
			expect(await neverHandedOver(admin)).toBe(false);

			// Same behavior as the entrypoint had: the failed migration is marked
			// rolled back and the (fixed) migration is tried again.
			project.writeMigration(bad.name, fixedSql);
			const messages: string[] = [];
			await prepare(scratch2.superUrl, {
				root: project.dir,
				log: (message) => messages.push(message),
				warn: () => undefined,
			});
			expect(messages.join("\n")).toContain(
				`Found failed migration: ${bad.name}`,
			);
			expect(messages).toContain(
				"Database migrations applied successfully after rollback!",
			);
			const { rows } = await owner.query<{ owner: string }>(
				"SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'public.a2_fixed'::regclass",
			);
			expect(rows[0]?.owner).toBe("retrospend_owner");
			expect(await ownerCanCreateIn(scratch2.superUrl)).toBe(false);
		} finally {
			project.cleanup();
			await owner.end();
			await admin.end();
		}
	}, 180_000);

	it("a migration may change its text once applied: Prisma deploy does not compare checksums", async () => {
		// The keystore migration was edited (CREATE SCHEMA IF NOT EXISTS became a
		// guarded DO block) after it had been applied on a development database.
		// Here the migration applied by the test above is edited and deployed.
		const project = makeScratchProject({
			extra: [
				window("20300101000000_second", "second"),
				{
					name: "20300102000000_breaks",
					sql: `${fixedSql}\n-- edited after it was applied`,
				},
			],
		});
		try {
			await expect(
				prepare(scratch2.superUrl, { root: project.dir, ...quiet }),
			).resolves.toBeDefined();
		} finally {
			project.cleanup();
		}
	}, 120_000);

	it("does not retry a first migration that failed as a new install: the documented reset is to drop the database and create it empty", async () => {
		const admin = await connect(scratch3.superUrl);
		const first = {
			name: "20300101000000_first",
			sql: `${window("x", "third").sql}\nSELECT 1 / 0;`,
		};
		const project = makeScratchProject({ extra: [first] });
		try {
			expect(await neverHandedOver(admin)).toBe(true);
			await expect(
				prepare(scratch3.superUrl, { root: project.dir, ...quiet }),
			).rejects.toThrow(/Migration failed/);
			expect(await ownerCanCreateIn(scratch3.superUrl)).toBe(false);
			// No marker keeps it new: the first migration, fixed, is refused with
			// the way out in the message.
			expect(await neverHandedOver(admin)).toBe(false);
			project.writeMigration(first.name, window("x", "third").sql);
			await expect(
				prepare(scratch3.superUrl, { root: project.dir, ...quiet }),
			).rejects.toThrow(/drop the database and create it again empty/);
			expect(await ownerCanCreateIn(scratch3.superUrl)).toBe(false);
		} finally {
			project.cleanup();
			await admin.end();
		}
	}, 180_000);

	it("gives a concurrent owner session no CREATE although the owner emptied public and left a payload in keystore", async () => {
		// The attack: the owner plants a function in keystore (which it owns) and
		// drops everything in public, so that public looks new. If the next
		// start then gave the owner CREATE, a second owner session could race the
		// migrations for it and CREATE SCHEMA zz; CREATE EXTENSION hstore WITH
		// SCHEMA zz (a trusted extension, its script runs as the superuser).
		const owner = await connect(scratch3.ownerUrl);
		const attacker = await connect(scratch3.ownerUrl);
		const admin = await connect(scratch3.superUrl);
		try {
			await owner.query(`
				DROP SCHEMA IF EXISTS a2_third_schema CASCADE;
				DROP TABLE IF EXISTS public._prisma_migrations;
				CREATE FUNCTION keystore.a2_payload() RETURNS trigger LANGUAGE plpgsql AS $f$
				BEGIN RETURN NEW; END $f$`);
			// Public is empty, and the catalogs still say it is not new.
			const { rows: left } = await owner.query<{ n: string }>(`
				SELECT count(*) AS n FROM pg_class
				 WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'v', 'S')`);
			expect(left[0]?.n).toBe("0");
			expect(await neverHandedOver(admin)).toBe(false);

			// The control: given CREATE, the attacker session does create a schema,
			// so a refusal below means something.
			const { rows: named } = await admin.query<{ name: string }>(
				"SELECT quote_ident(current_database()) AS name",
			);
			await admin.query(
				`GRANT CREATE ON DATABASE ${named[0]?.name} TO retrospend_owner`,
			);
			try {
				await attacker.query("CREATE SCHEMA a2_control");
				await attacker.query("DROP SCHEMA a2_control");
			} finally {
				await admin.query(
					`REVOKE CREATE ON DATABASE ${named[0]?.name} FROM retrospend_owner`,
				);
			}

			let attempts = 0;
			const wins: string[] = [];
			let stop = false;
			const race = (async () => {
				while (!stop) {
					attempts++;
					for (const sql of [
						"CREATE SCHEMA a2_zz",
						"CREATE EXTENSION hstore WITH SCHEMA a2_zz",
						"SELECT 1 WHERE has_database_privilege(current_user, current_database(), 'CREATE')",
					]) {
						try {
							const result = await attacker.query(sql);
							if (result.command !== "SELECT" || result.rowCount) {
								wins.push(sql);
							}
						} catch {
							// refused
						}
					}
				}
			})();
			const project = makeScratchProject({
				extra: [window("20300101000000_first", "again")],
			});
			try {
				await expect(
					prepare(scratch3.superUrl, { root: project.dir, ...quiet }),
				).rejects.toThrow(/Migration failed/);
			} finally {
				project.cleanup();
				stop = true;
				await race;
			}
			expect(attempts).toBeGreaterThan(1);
			expect(wins).toEqual([]);
			const { rows } = await owner.query<{
				schemas: string;
				extensions: string;
			}>(`
				SELECT (SELECT count(*) FROM pg_namespace WHERE nspname = 'a2_zz') AS schemas,
				       (SELECT count(*) FROM pg_extension WHERE extname = 'hstore') AS extensions`);
			expect(rows[0]).toEqual({ schemas: "0", extensions: "0" });
		} finally {
			await owner.end();
			await attacker.end();
			await admin.end();
		}
	}, 120_000);
});

describe("neverHandedOver (is this a brand-new, empty database?)", () => {
	const inRolledBack = (steps: (client: Client) => Promise<void>) =>
		withSuperuser(async (client) => {
			await client.query("BEGIN");
			try {
				await steps(client);
			} finally {
				await client.query("ROLLBACK");
			}
		});

	it("is no for a migrated database, and an old marker setting changes nothing", async () => {
		await inRolledBack(async (client) => {
			expect(await neverHandedOver(client)).toBe(false);
			// What an earlier version kept between starts: only a superuser can
			// write it, and it means nothing now.
			const { rows } = await client.query<{ name: string }>(
				"SELECT quote_ident(current_database()) AS name",
			);
			await client.query(
				`ALTER DATABASE ${rows[0]?.name} SET retrospend.fresh_install = 'on'`,
			);
			expect(await neverHandedOver(client)).toBe(false);
		});
	});

	it("is yes only when nothing in any schema can carry code, and the unaccent extension does not count", async () => {
		await inRolledBack(async (client) => {
			await client.query("DROP SCHEMA keystore CASCADE");
			await client.query("DROP SCHEMA public CASCADE");
			await client.query("CREATE SCHEMA public");
			expect(await neverHandedOver(client)).toBe(true);
			// An extension's own objects are not the owner's.
			await client.query("CREATE EXTENSION unaccent WITH SCHEMA public");
			expect(await neverHandedOver(client)).toBe(true);
		});
	});

	it("is no for a payload in any schema, however empty public is", async () => {
		const payloads = [
			"CREATE SCHEMA keystore; CREATE FUNCTION keystore.p() RETURNS int LANGUAGE sql AS 'SELECT 1'",
			"CREATE SCHEMA keystore; CREATE TABLE keystore.t (id int)",
			"CREATE SCHEMA other; CREATE VIEW other.v AS SELECT 1 AS one",
			"CREATE SCHEMA other; CREATE SEQUENCE other.s",
			"CREATE SCHEMA other; CREATE TYPE other.mood AS ENUM ('ok')",
			"CREATE SCHEMA other; CREATE DOMAIN other.d AS integer",
			"CREATE FUNCTION public.p() RETURNS int LANGUAGE sql AS 'SELECT 1'",
			"CREATE TABLE public.t (id int)",
			"CREATE OPERATOR public.@@@ (leftarg = int, rightarg = int, function = int4pl)",
		];
		await inRolledBack(async (client) => {
			await client.query("DROP SCHEMA keystore CASCADE");
			await client.query("DROP SCHEMA public CASCADE");
			await client.query("CREATE SCHEMA public");
			for (const payload of payloads) {
				await client.query("SAVEPOINT p");
				await client.query(payload);
				expect(await neverHandedOver(client), payload).toBe(false);
				await client.query("ROLLBACK TO SAVEPOINT p");
			}
			expect(await neverHandedOver(client)).toBe(true);
		});
	});
});
