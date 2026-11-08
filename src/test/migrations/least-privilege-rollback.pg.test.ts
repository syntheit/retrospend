// The rollback snippet for 20261109600000_least_privilege (prisma/rollback/,
// not a migration). An image rollback cannot undo a migration, so the snippet
// has to put the grants, the user row-level security and the default
// privileges back by hand. This builds a database migrated to the migration
// before it, clones it, applies the migration to the clone and then the
// snippet, and compares every table's ACL (including column ACLs), row-level
// security flags, policies, sequence ACLs and the table and sequence default
// privileges with the database that never had the migration.
//
// Function default privileges are left out: the migration shares that change
// with the definer hygiene migration, whose rollback owns it.
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseTestDatabaseUrl } from "~/test/pg-global-setup";
import { REPO_ROOT } from "../uiRules/paths";
import { readDefaultAcls, readPrivilegeCatalog } from "./privilege-catalog";

const MIGRATION = "20261109600000_least_privilege";
const MIGRATIONS = join(REPO_ROOT, "prisma/migrations");

const { baseUrl, baseName } = parseTestDatabaseUrl(
	process.env.TEST_DATABASE_URL,
);
const suffix = randomBytes(2).toString("hex");
const beforeName = `${baseName}_lp${suffix}_before`;
const afterName = `${baseName}_lp${suffix}_after`;

function urlFor(database: string): string {
	const url = new URL(baseUrl);
	url.pathname = `/${database}`;
	return url.toString();
}

async function withClient<T>(
	database: string,
	run: (client: Client) => Promise<T>,
): Promise<T> {
	const client = new Client({ connectionString: urlFor(database) });
	await client.connect();
	try {
		return await run(client);
	} finally {
		await client.end();
	}
}

function migrationFolders(): string[] {
	return readdirSync(MIGRATIONS, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

function migrationSql(folder: string): string {
	return readFileSync(join(MIGRATIONS, folder, "migration.sql"), "utf8");
}

const rollbackSql = () =>
	readFileSync(join(REPO_ROOT, "prisma/rollback", `${MIGRATION}.sql`), "utf8");

/** Every ACL entry on every table, column and sequence, as plain strings. */
async function aclEntries(client: Client): Promise<string[]> {
	const { rows } = await client.query<{ entry: string }>(`
		SELECT c.relname || ' ' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END
		       || ' ' || a.privilege_type || CASE WHEN a.is_grantable THEN '*' ELSE '' END AS entry
		FROM pg_class c
		CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault((CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) a
		WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'S')
		UNION ALL
		SELECT c.relname || '.' || at.attname || ' ' || pg_get_userbyid(a.grantee)::text
		       || ' ' || a.privilege_type AS entry
		FROM pg_attribute at
		JOIN pg_class c ON c.oid = at.attrelid
		CROSS JOIN LATERAL aclexplode(at.attacl) a
		WHERE c.relnamespace = 'public'::regnamespace AND at.attacl IS NOT NULL
		ORDER BY 1`);
	return rows.map((r) => r.entry);
}

async function policies(client: Client): Promise<string[]> {
	const { rows } = await client.query<{ policy: string }>(`
		SELECT c.relname || ' ' || p.polname || ' ' || p.polcmd::text || ' '
		       || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' | '
		       || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') AS policy
		FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
		ORDER BY 1`);
	return rows.map((r) => r.policy);
}

async function snapshot(database: string) {
	return withClient(database, async (client) => ({
		acl: await aclEntries(client),
		catalog: await readPrivilegeCatalog(client),
		policies: await policies(client),
		defaults: (await readDefaultAcls(client)).filter(
			(d) => d.kind === "r" || d.kind === "S",
		),
	}));
}

describe("rollback of 20261109600000_least_privilege", () => {
	beforeAll(async () => {
		const folders = migrationFolders();
		const index = folders.indexOf(MIGRATION);
		expect(index).toBeGreaterThan(0);
		const admin = new Client({ connectionString: urlFor("postgres") });
		await admin.connect();
		try {
			await admin.query(`CREATE DATABASE "${beforeName}"`);
		} finally {
			await admin.end();
		}
		// Migrated up to the one before the migration under test. Prisma makes its
		// own table before the first migration, so it gets the same grants.
		await withClient(beforeName, async (client) => {
			await client.query(`
				CREATE TABLE "_prisma_migrations" (
				  "id" VARCHAR(36) PRIMARY KEY,
				  "checksum" VARCHAR(64) NOT NULL,
				  "finished_at" TIMESTAMPTZ,
				  "migration_name" VARCHAR(255) NOT NULL,
				  "logs" TEXT,
				  "rolled_back_at" TIMESTAMPTZ,
				  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
				  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
				)`);
			for (const folder of folders.slice(0, index)) {
				await client.query(migrationSql(folder));
			}
		});
		// A clone fails while anyone is connected to its source.
		const maintenance = new Client({ connectionString: urlFor("postgres") });
		await maintenance.connect();
		try {
			await maintenance.query(
				`CREATE DATABASE "${afterName}" TEMPLATE "${beforeName}"`,
			);
		} finally {
			await maintenance.end();
		}
	}, 240_000);

	afterAll(async () => {
		const admin = new Client({ connectionString: urlFor("postgres") });
		await admin.connect();
		try {
			for (const name of [afterName, beforeName]) {
				await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
			}
		} finally {
			await admin.end();
		}
	});

	it("puts back every grant, policy, security flag and default the migration changed", async () => {
		const before = await snapshot(beforeName);
		// The database before the migration is the one with the blanket grants.
		expect(before.catalog.tables.user?.privileges).toEqual([
			"DELETE",
			"INSERT",
			"SELECT",
			"UPDATE",
		]);
		expect(before.catalog.tables.user?.rls).toBe(false);

		await withClient(afterName, (client) =>
			client.query(migrationSql(MIGRATION)),
		);
		const migrated = await snapshot(afterName);
		// The migration did change things, so the comparison below can fail.
		expect(migrated.catalog.tables.user?.rls).toBe(true);
		expect(migrated.acl).not.toEqual(before.acl);
		expect(migrated.defaults).not.toEqual(before.defaults);

		await withClient(afterName, (client) => client.query(rollbackSql()));
		const restored = await snapshot(afterName);

		expect(restored.acl).toEqual(before.acl);
		expect(restored.catalog).toEqual(before.catalog);
		expect(restored.policies).toEqual(before.policies);
		expect(restored.defaults).toEqual(before.defaults);
	}, 120_000);

	it("can run twice", async () => {
		const before = await snapshot(beforeName);
		await withClient(afterName, (client) => client.query(rollbackSql()));
		const again = await snapshot(afterName);
		expect(again.acl).toEqual(before.acl);
		expect(again.policies).toEqual(before.policies);
		expect(again.defaults).toEqual(before.defaults);
	}, 60_000);

	it("the migration itself can run twice", async () => {
		await withClient(afterName, async (client) => {
			await client.query(migrationSql(MIGRATION));
			const once = await aclEntries(client);
			await client.query(migrationSql(MIGRATION));
			expect(await aclEntries(client)).toEqual(once);
		});
		const migrated = await snapshot(afterName);
		const expected = (await import("./retrospend-app-privileges.json")).default;
		expect(migrated.catalog.tables).toEqual(expected.tables);
		expect(migrated.catalog.columns).toEqual(expected.columns);
	}, 60_000);
});
