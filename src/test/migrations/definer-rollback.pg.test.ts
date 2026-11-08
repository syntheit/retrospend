// The rollback snippet for 20261109500000_definer_hygiene
// (prisma/rollback/, not a migration). An image rollback cannot undo a
// migration, so the snippet has to put the function grants and search_path
// back by hand.
//
// This creates no database: creating or dropping one holds an xid long enough
// to stall the outbox horizon every other pg worker waits on. It works in the
// worker's own, fully migrated database, inside one transaction that always
// ends in ROLLBACK (GRANT, REVOKE, ALTER FUNCTION and ALTER DEFAULT PRIVILEGES
// are transactional): capture the catalog, apply the snippet, capture again,
// apply the migration, capture a third time.
//   - after the snippet, every function in definer-catalog.before.json has the
//     mode, search_path and ACL it had before the migration, and the function
//     default privileges match;
//   - after the migration again, the catalog equals the first capture.
//
// definer-catalog.before.json is the catalog of a database migrated to the
// migration before this one. Regenerate it only if that state must change:
//   createdb scratch && for each folder older than 20261109500000, in order:
//     psql -v ON_ERROR_STOP=1 -d scratch -f prisma/migrations/<folder>/migration.sql
//   psql -At -d scratch -f src/test/migrations/definer-catalog.sql \
//     > src/test/migrations/definer-catalog.before.json
// A NULL function ACL is read as the default ACL it stands for (acldefault),
// because SQL cannot write the NULL back: granting PUBLIC again stores the
// same owner-and-PUBLIC default as explicit entries.
//
// Functions a later migration adds are not in the JSON and are ignored. A later
// migration that changes the grants of one that is in it fails this test: the
// snippet then needs a second look.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../uiRules/paths";

const MIGRATION = "20261109500000_definer_hygiene";

type FunctionState = {
	sig: string;
	definer: boolean;
	config: string;
	acl: string;
};
type Catalog = {
	functions: FunctionState[];
	defaults: { role: string; schema: string; acl: string }[];
};

const read = (...parts: string[]) =>
	readFileSync(join(REPO_ROOT, ...parts), "utf8");

const catalogSql = read("src/test/migrations/definer-catalog.sql");
const before: Catalog = JSON.parse(
	read("src/test/migrations/definer-catalog.before.json"),
);
const migrationSql = read("prisma/migrations", MIGRATION, "migration.sql");
const rollbackSql = read("prisma/rollback", `${MIGRATION}.sql`);

class Rollback extends Error {}

async function capture(client: Client): Promise<Catalog> {
	const result = await client.query<{ jsonb_pretty: string }>(catalogSql);
	return JSON.parse(result.rows[0]?.jsonb_pretty ?? "{}");
}

/** Runs the steps in one transaction on the worker's database, then rolls back. */
async function inRolledBackTransaction(
	steps: (client: Client) => Promise<void>,
) {
	const client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	try {
		await client.query("BEGIN");
		await steps(client);
		throw new Rollback();
	} catch (error) {
		await client.query("ROLLBACK");
		if (!(error instanceof Rollback)) throw error;
	} finally {
		await client.end();
	}
}

describe("rollback of 20261109500000_definer_hygiene", () => {
	it("puts back every grant, search_path and default the migration changed, and the migration applies again", async () => {
		let migrated: Catalog | undefined;
		let restored: Catalog | undefined;
		let reapplied: Catalog | undefined;
		await inRolledBackTransaction(async (client) => {
			migrated = await capture(client);
			await client.query(rollbackSql);
			restored = await capture(client);
			await client.query(migrationSql);
			reapplied = await capture(client);
		});
		if (!migrated || !restored || !reapplied) throw new Error("no capture");

		const bySig = (catalog: Catalog) =>
			new Map(catalog.functions.map((f) => [f.sig, f]));
		const now = bySig(migrated);
		const back = bySig(restored);

		// The migration did change things, so the comparison below can fail.
		const changed = before.functions.filter(
			(f) => JSON.stringify(now.get(f.sig)) !== JSON.stringify(f),
		);
		expect(changed.length).toBeGreaterThanOrEqual(30);

		// Every function of the earlier catalog is back as it was.
		expect(before.functions.map((f) => back.get(f.sig))).toEqual(
			before.functions,
		);
		expect(restored.defaults).toEqual(before.defaults);

		// The migration, run on top of the snippet, lands where it started.
		expect(reapplied).toEqual(migrated);
	}, 60_000);

	it("left the worker's database as the migration made it", async () => {
		const client = new Client({ connectionString: process.env.DATABASE_URL });
		await client.connect();
		try {
			const [row] = (
				await client.query<{ open: boolean }>(
					`SELECT has_function_privilege('retrospend_app', 'budget_party_user(text,text)', 'EXECUTE') AS open`,
				)
			).rows;
			expect(row?.open).toBe(false);
		} finally {
			await client.end();
		}
	});
});
