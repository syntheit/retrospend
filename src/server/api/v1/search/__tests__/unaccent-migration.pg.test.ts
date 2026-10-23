/**
 * The search_unaccent migration on a database where unaccent already lives
 * in another schema, and run twice: the wrapper must call it from where it
 * is, and the app role must be able to use it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
	join(
		process.cwd(),
		"prisma/migrations/20261024200001_search_unaccent/migration.sql",
	),
	"utf8",
);

async function unaccentAsApp(client: Client, text: string) {
	await client.query("BEGIN");
	try {
		await client.query("SET LOCAL ROLE retrospend_app");
		const { rows } = await client.query<{ out: string }>(
			"SELECT public.immutable_unaccent($1) AS out",
			[text],
		);
		return rows[0]?.out;
	} finally {
		await client.query("ROLLBACK");
	}
}

async function extensionSchema(client: Client) {
	const { rows } = await client.query<{ nspname: string }>(
		`SELECT n.nspname FROM pg_extension e
		   JOIN pg_namespace n ON n.oid = e.extnamespace
		  WHERE e.extname = 'unaccent'`,
	);
	return rows[0]?.nspname;
}

describe("search_unaccent migration", () => {
	const client = new Client({ connectionString: process.env.DATABASE_URL });

	beforeAll(async () => {
		await client.connect();
	});

	afterAll(async () => {
		// Other test files share this database: put unaccent back in public.
		await client.query("ALTER EXTENSION unaccent SET SCHEMA public");
		await client.query(MIGRATION);
		await client.query("DROP SCHEMA IF EXISTS ext_elsewhere");
		await client.end();
	});

	it("is idempotent where it was applied", async () => {
		await client.query(MIGRATION);
		expect(await extensionSchema(client)).toBe("public");
		expect(await unaccentAsApp(client, "Café MUÑOZ")).toBe("Cafe MUNOZ");
	});

	it("uses unaccent from the schema it is installed in", async () => {
		await client.query("CREATE SCHEMA IF NOT EXISTS ext_elsewhere");
		await client.query("ALTER EXTENSION unaccent SET SCHEMA ext_elsewhere");
		await client.query(MIGRATION);
		await client.query(MIGRATION);
		expect(await extensionSchema(client)).toBe("ext_elsewhere");
		expect(await unaccentAsApp(client, "Ñandú")).toBe("Nandu");
	});
});
