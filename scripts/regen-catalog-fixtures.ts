/**
 * Rewrites the two catalog fixtures of the rollback tests from a scratch
 * database migrated to the state before each migration:
 *   src/test/migrations/definer-catalog.before.json
 *   src/test/migrations/pre-least-privilege-catalog.json
 * Regenerate them only if an earlier migration is ever rewritten.
 *
 * The scratch database is migrated as the superuser, with no owner bootstrap,
 * through a scratch Prisma project that links only the migrations before the
 * cutoff: the state of an install from before the owner role existed, which is
 * what both files hold. The role that ran the migrations, and so owns every
 * object and holds the default privileges, is written as <owner>, so the files
 * do not depend on which role it was.
 *
 * Usage:
 *   TEST_DATABASE_URL=postgresql://postgres:<password>@localhost:5436/retrospend_test_<name> \
 *     pnpm test:regen-fixtures
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import {
	onlyTables,
	type Queryable,
	readCatalogSnapshot,
	readFunctionCatalog,
} from "../src/test/migrations/privilege-catalog";
import {
	DEFINER_MIGRATION,
	LEAST_PRIVILEGE_MIGRATION,
	LEAST_PRIVILEGE_TABLES,
} from "../src/test/migrations/rollback-fixtures";
import { parseTestDatabaseUrl } from "../src/test/pg-test-url";
import { makeScratchProject } from "../src/test/scratch-project";
import { migrateWithRecovery } from "./db-owner/index.mjs";

const DIR = join(process.cwd(), "src/test/migrations");

type Fixture = {
	file: string;
	/** The first migration the fixture's state does not include. */
	cutoff: string;
	/** The file's text, read from a database migrated to just before the cutoff. */
	read: (client: Queryable) => Promise<string>;
};

const FIXTURES: Fixture[] = [
	{
		file: "definer-catalog.before.json",
		cutoff: DEFINER_MIGRATION,
		read: async (client) =>
			`${JSON.stringify(await readFunctionCatalog(client), null, 4)}\n`,
	},
	{
		file: "pre-least-privilege-catalog.json",
		cutoff: LEAST_PRIVILEGE_MIGRATION,
		read: async (client) => {
			const snapshot = await readCatalogSnapshot(client);
			const tables = onlyTables(snapshot, LEAST_PRIVILEGE_TABLES);
			return `${JSON.stringify(tables, null, "\t")}\n`;
		},
	},
];

/** A scratch database migrated to just before `cutoff`, read as the superuser, then dropped. */
async function withMigratedDatabase<T>(
	cutoff: string,
	read: (client: Client) => Promise<T>,
): Promise<T> {
	const { baseUrl, baseName } = parseTestDatabaseUrl(
		process.env.TEST_DATABASE_URL,
	);
	const name = `${baseName}_${randomBytes(2).toString("hex")}_rgn`;
	const urlFor = (database: string) => {
		const url = new URL(baseUrl);
		url.pathname = `/${database}`;
		return url.toString();
	};
	const admin = new Client({ connectionString: urlFor("postgres") });
	await admin.connect();
	const scratch = makeScratchProject({ realMigrationsBefore: cutoff });
	try {
		await admin.query(`CREATE DATABASE "${name}"`);
		await migrateWithRecovery(urlFor(name), {
			root: scratch.dir,
			log: () => undefined,
		});
		const client = new Client({ connectionString: urlFor(name) });
		await client.connect();
		try {
			return await read(client);
		} finally {
			await client.end();
		}
	} finally {
		scratch.cleanup();
		await admin
			.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
			.finally(() => admin.end());
	}
}

async function main() {
	for (const fixture of FIXTURES) {
		const text = await withMigratedDatabase(fixture.cutoff, fixture.read);
		writeFileSync(join(DIR, fixture.file), text);
		console.log(`wrote src/test/migrations/${fixture.file}`);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
