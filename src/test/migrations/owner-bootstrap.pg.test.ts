import { describe, expect, it } from "vitest";
import { superUrl, withSuperuser } from "~/test/pg-harness";
import {
	inRolledBackTransaction,
	readSqlWithoutTransaction,
} from "~/test/rolled-back-sql";
import {
	enforceOwnerRole,
	handoverStatements,
	neverHandedOver,
	ownerProblems,
} from "../../../scripts/db-owner/index.mjs";

describe("prisma/bootstrap/owner-role.sql", () => {
	// Without its own BEGIN and COMMIT, so that COMMIT cannot end the test's
	// transaction, which always rolls back.
	const sql = readSqlWithoutTransaction("prisma/bootstrap/owner-role.sql");

	it("takes CREATE on the database away from the owner if it holds it", async () => {
		// The owner never holds it: only a one-shot migration role does, on a
		// brand-new install. With it the owner could CREATE EXTENSION a trusted
		// extension into a schema it controls, and the install script would run
		// as the superuser.
		await inRolledBackTransaction(async (client) => {
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
		}, superUrl());
	});

	it("reads and calls nothing of the owner's: an owner-made view in place of _prisma_migrations does not run", async () => {
		// The attack: the owner owns _prisma_migrations, so it can replace it with
		// a view whose condition calls a function. A superuser that reads the
		// table runs that function with superuser rights (here it grants the
		// owner pg_execute_server_program, which means COPY ... TO PROGRAM).
		await inRolledBackTransaction(async (client) => {
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
		}, superUrl());
	});

	it("refuses a role that holds a pg_ role, a role-creating role or another member, however it got there", async () => {
		await inRolledBackTransaction(async (client) => {
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
		}, superUrl());
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
		await inRolledBackTransaction(async (client) => {
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
		}, superUrl());
	});

	it("pins its search_path and keeps PUBLIC from creating objects in public", () => {
		expect(sql).toContain("SET LOCAL search_path = pg_catalog, pg_temp");
		expect(sql).toContain("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
	});
});

describe("neverHandedOver (is this a brand-new, empty database?)", () => {
	it("is no for a migrated database, and an old marker setting changes nothing", async () => {
		await inRolledBackTransaction(async (client) => {
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
		}, superUrl());
	});

	it("is yes only when nothing in any schema can carry code, and the unaccent extension does not count", async () => {
		await inRolledBackTransaction(async (client) => {
			await client.query("DROP SCHEMA keystore CASCADE");
			await client.query("DROP SCHEMA public CASCADE");
			await client.query("CREATE SCHEMA public");
			expect(await neverHandedOver(client)).toBe(true);
			// An extension's own objects are not the owner's.
			await client.query("CREATE EXTENSION unaccent WITH SCHEMA public");
			expect(await neverHandedOver(client)).toBe(true);
		}, superUrl());
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
		await inRolledBackTransaction(async (client) => {
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
		}, superUrl());
	});
});
