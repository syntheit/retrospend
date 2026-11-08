import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { adminDb } from "~/test/pg-harness";
import { migratorRoleName } from "../../../scripts/db-owner/index.mjs";
import {
	connect,
	databaseOf,
	failureOf,
	failureOutsideTransaction,
	foreignOwned,
} from "../db-owner/helpers";
import { readPrivilegeCatalog } from "./privilege-catalog";
import expected from "./retrospend-app-privileges.json";

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

	it("is done for every object the migrations created: the migration role made them and they went to the owner", () => {
		// The template was migrated by `prisma migrate deploy` as the one-shot
		// migration role of a new install; REASSIGN OWNED gave everything it made
		// to retrospend_owner. A second bootstrap handed over nothing.
		expect(inject("pgFresh").handedOverAfterMigrate).toBe(0);
	});

	it("leaves no trace of the one-shot migration role: every ACL names the owner as grantor, and the role is gone", async () => {
		// The template was migrated by a role that no longer exists. REASSIGN
		// OWNED rewrote the owner and grantor entries of every ACL it left behind.
		const client = await connect(process.env.DATABASE_URL as string);
		try {
			const { rows } = await client.query<{ object: string; grantor: string }>(`
				WITH owner AS (SELECT oid FROM pg_roles WHERE rolname = 'retrospend_owner')
				SELECT 'relation ' || c.relname AS object, pg_get_userbyid(a.grantor) AS grantor
				  FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
				 WHERE c.relnamespace IN ('public'::regnamespace, 'keystore'::regnamespace)
				   AND a.grantor <> (SELECT oid FROM owner)
				UNION ALL
				SELECT 'function ' || p.proname, pg_get_userbyid(a.grantor)
				  FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
				 WHERE p.pronamespace IN ('public'::regnamespace, 'keystore'::regnamespace)
				   AND a.grantor <> (SELECT oid FROM owner)
				   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
				UNION ALL
				SELECT 'schema ' || n.nspname, pg_get_userbyid(a.grantor)
				  FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
				 WHERE n.nspname IN ('public', 'keystore')
				   AND a.grantor <> (SELECT oid FROM owner)`);
			expect(rows).toEqual([]);
			const { rows: roles } = await client.query<{ name: string }>(
				"SELECT rolname AS name FROM pg_roles WHERE rolname = $1",
				[migratorRoleName(databaseOf(process.env.DATABASE_URL as string))],
			);
			expect(roles).toEqual([]);
			// Nothing in the cluster still depends on a role of that name's kind.
			const { rows: dangling } = await client.query<{ n: string }>(`
				SELECT count(*) AS n FROM pg_shdepend s
				 WHERE s.refclassid = 'pg_authid'::regclass
				   AND NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid = s.refobjid)`);
			expect(dangling[0]?.n).toBe("0");
		} finally {
			await client.end();
		}
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
