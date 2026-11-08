// The rollback snippet for 20261109500000_definer_hygiene
// (prisma/rollback/, not a migration). An image rollback cannot undo a
// migration, so the snippet has to put the function grants and search_path
// back by hand. This builds a database migrated to the migration before it,
// clones it, applies the migration to the clone and then the snippet, and
// compares every function's mode, search_path and ACL, and the function
// default privileges, with the database that never had the migration.
//
// One representation differs and is normalized away: a function nobody ever
// granted on has a NULL ACL, which Postgres reads as "owner and PUBLIC may
// execute". Granting to PUBLIC again stores that same default as explicit
// entries, and SQL cannot write the NULL back. Both are compared as the
// default ACL they stand for (acldefault).
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseTestDatabaseUrl } from "~/test/pg-global-setup";
import { REPO_ROOT } from "../uiRules/paths";

const MIGRATION = "20261109500000_definer_hygiene";
const MIGRATIONS = join(REPO_ROOT, "prisma/migrations");

type FunctionState = {
	sig: string;
	definer: boolean;
	config: string;
	acl: string | null;
};

type DefaultState = {
	role: string;
	schema: string;
	kind: string;
	acl: string;
};

const { baseUrl, baseName } = parseTestDatabaseUrl(
	process.env.TEST_DATABASE_URL,
);
const suffix = randomBytes(2).toString("hex");
const beforeName = `${baseName}_rb${suffix}_before`;
const afterName = `${baseName}_rb${suffix}_after`;

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

async function snapshot(database: string) {
	return withClient(database, async (client) => {
		const functions = await client.query<FunctionState>(`
			SELECT p.oid::regprocedure::text AS sig,
			       p.prosecdef AS definer,
			       coalesce(array_to_string(p.proconfig, ';'), '') AS config,
			       (SELECT string_agg(
			                 CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
			                   || ':' || a.privilege_type
			                   || CASE WHEN a.is_grantable THEN '*' ELSE '' END,
			                 ',' ORDER BY a.grantee, a.privilege_type)
			          FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a) AS acl
			FROM pg_proc p
			WHERE p.pronamespace = 'public'::regnamespace
			  AND p.prokind IN ('f', 'p')
			  AND NOT EXISTS (
			    SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
			  )
			ORDER BY 1`);
		const defaults = await client.query<DefaultState>(`
			SELECT pg_get_userbyid(defaclrole)::text AS role,
			       defaclnamespace::text AS schema,
			       defaclobjtype::text AS kind,
			       defaclacl::text AS acl
			FROM pg_default_acl
			ORDER BY 1, 2, 3`);
		return { functions: functions.rows, defaults: defaults.rows };
	});
}

describe("rollback of 20261109500000_definer_hygiene", () => {
	beforeAll(async () => {
		const folders = migrationFolders();
		const index = folders.indexOf(MIGRATION);
		expect(index).toBeGreaterThan(0);
		const admin = new Client({
			connectionString: urlFor("postgres"),
		});
		await admin.connect();
		try {
			await admin.query(`CREATE DATABASE "${beforeName}"`);
		} finally {
			await admin.end();
		}
		// Migrated up to the one before the migration under test.
		await withClient(beforeName, async (client) => {
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

	it("puts back every grant, search_path and default the migration changed", async () => {
		const before = await snapshot(beforeName);

		await withClient(afterName, (client) =>
			client.query(migrationSql(MIGRATION)),
		);
		const migrated = await snapshot(afterName);
		const changed = migrated.functions.filter(
			(f, i) => JSON.stringify(f) !== JSON.stringify(before.functions[i]),
		);
		// The migration did change things, so the comparison below can fail.
		expect(changed.length).toBeGreaterThanOrEqual(30);
		expect(migrated.defaults).not.toEqual(before.defaults);

		const rollback = readFileSync(
			join(REPO_ROOT, "prisma/rollback", `${MIGRATION}.sql`),
			"utf8",
		);
		await withClient(afterName, (client) => client.query(rollback));
		const restored = await snapshot(afterName);

		expect(restored.functions).toEqual(before.functions);
		expect(restored.defaults).toEqual(before.defaults);
	}, 120_000);

	it("can run twice", async () => {
		const before = await snapshot(beforeName);
		const rollback = readFileSync(
			join(REPO_ROOT, "prisma/rollback", `${MIGRATION}.sql`),
			"utf8",
		);
		await withClient(afterName, (client) => client.query(rollback));
		expect((await snapshot(afterName)).functions).toEqual(before.functions);
	}, 60_000);
});
