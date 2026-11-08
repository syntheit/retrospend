// Installs that older releases migrated as the superuser: the handover of every
// kind of object, and the upgrade of the legacy and the 0.4.x databases the
// global setup made (pg-global-setup.ts; only this file reads them). The owner
// migrates them with no CREATE on the database for anyone, so planted owner code
// can create nothing.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { superUrl } from "~/test/pg-harness";
import { inRolledBackTransaction } from "~/test/rolled-back-sql";
import {
	applyGrants,
	bootstrap,
	handover,
	handoverStatements,
	migrateWithRecovery,
	migratorRoleName,
	neverHandedOver,
	ownerProblems,
} from "../../../scripts/db-owner/index.mjs";
import {
	connect,
	databaseOf,
	foreignOwned,
	migratorExists,
	ownerCanCreateIn,
} from "../db-owner/helpers";
import { REPO_ROOT } from "../uiRules/paths";
import { readPrivilegeCatalog } from "./privilege-catalog";
import expected from "./retrospend-app-privileges.json";

describe("the handover from an install the superuser migrated", () => {
	it("finds every kind of object, hands them over, and a second run finds none", async () => {
		await inRolledBackTransaction(async (admin) => {
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
		}, superUrl());
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

	it("removes a migration role that a killed start left, with what it owned and its grants", async () => {
		const role = migratorRoleName(databaseOf(legacy.superUrl));
		await admin.query(
			`CREATE ROLE "${role}" LOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB`,
		);
		const { rows: named } = await admin.query<{ name: string }>(
			"SELECT quote_ident(current_database()) AS name",
		);
		try {
			await admin.query(
				`GRANT CREATE ON DATABASE ${named[0]?.name} TO "${role}"`,
			);
			await admin.query("CREATE TABLE public.a2_leftover (id integer)");
			await admin.query(`ALTER TABLE public.a2_leftover OWNER TO "${role}"`);
			await admin.query(
				`ALTER DEFAULT PRIVILEGES FOR ROLE "${role}" GRANT SELECT ON TABLES TO retrospend_app`,
			);
			expect(await migratorExists(legacy.superUrl)).toBe(true);

			await bootstrap(legacy.superUrl);

			expect(await migratorExists(legacy.superUrl)).toBe(false);
			const { rows } = await admin.query<{ owner: string }>(
				"SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'public.a2_leftover'::regclass",
			);
			expect(rows[0]?.owner).toBe("retrospend_owner");
			expect(await ownerCanCreateIn(legacy.superUrl)).toBe(false);
		} finally {
			await admin.query("DROP TABLE IF EXISTS public.a2_leftover");
			await admin.query(`DROP OWNED BY "${role}"`).catch(() => undefined);
			await admin.query(`DROP ROLE IF EXISTS "${role}"`);
		}
	});

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
