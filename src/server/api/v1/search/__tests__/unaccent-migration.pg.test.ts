/**
 * The search_unaccent migration on a database where unaccent already lives
 * in another schema, and run twice: the wrapper must call it from where it
 * is, and the app role must be able to use it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { superUrl } from "~/test/pg-harness";
import { inRolledBackTransaction } from "~/test/rolled-back-sql";

const MIGRATION = readFileSync(
	join(
		process.cwd(),
		"prisma/migrations/20261024200001_search_unaccent/migration.sql",
	),
	"utf8",
);

async function unaccentAsApp(client: Client, text: string) {
	await client.query("SET LOCAL ROLE retrospend_app");
	try {
		const { rows } = await client.query<{ out: string }>(
			"SELECT public.immutable_unaccent($1) AS out",
			[text],
		);
		return rows[0]?.out;
	} finally {
		await client.query("RESET ROLE");
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

// Each test runs in a transaction that is rolled back, so the extension is
// back in public and the schema is gone for the next file.
describe("search_unaccent migration", () => {
	it("is idempotent where it was applied", async () => {
		await inRolledBackTransaction(async (client) => {
			await client.query(MIGRATION);
			expect(await extensionSchema(client)).toBe("public");
			expect(await unaccentAsApp(client, "Café MUÑOZ")).toBe("Cafe MUNOZ");
		});
	});

	it("uses unaccent from the schema it is installed in", async () => {
		// As the superuser: moving an extension to a new schema needs CREATE on
		// the database and ownership of the extension, which retrospend_owner
		// does not have. The migration itself runs as the owner everywhere else.
		await inRolledBackTransaction(async (client) => {
			await client.query("CREATE SCHEMA IF NOT EXISTS ext_elsewhere");
			await client.query("ALTER EXTENSION unaccent SET SCHEMA ext_elsewhere");
			await client.query(MIGRATION);
			await client.query(MIGRATION);
			expect(await extensionSchema(client)).toBe("ext_elsewhere");
			expect(await unaccentAsApp(client, "Ñandú")).toBe("Nandu");
		}, superUrl());
	});
});
