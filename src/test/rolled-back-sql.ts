/**
 * The one way a pg test replays a migration. A worker's database outlives the
 * files it runs, and the migrations rewrite functions (their grants and their
 * search_path), triggers and policies, so a replay that commits changes the
 * catalog for every later file in that worker and makes results depend on file
 * order. These helpers run the steps in one transaction that always ends in
 * ROLLBACK, so the database is as the template left it. A test that needs the
 * replayed state runs its assertions inside the callback.
 *
 * `rolled-back-sql.test.ts` fails any test file that runs migration SQL outside
 * them. Creating a database for this is no alternative: CREATE and DROP
 * DATABASE hold an xid that stalls the outbox horizon of every other worker.
 */
import { Client } from "pg";
import type { Prisma } from "~prisma";

class Rollback extends Error {}

/** On a plain `pg` client, for tests that read and write with SQL. */
export async function inRolledBackTransaction(
	steps: (client: Client) => Promise<void>,
): Promise<void> {
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

/**
 * On a Prisma transaction client, for tests that read through models or
 * figures. `run` executes SQL text (a migration, or DDL) on that transaction.
 * The transaction timeout is long: a migration replay is slower than the
 * default 5 seconds.
 */
export async function inRolledBackPrismaTransaction(
	steps: (
		tx: Prisma.TransactionClient,
		run: (sql: string, ...params: unknown[]) => Promise<number>,
	) => Promise<void>,
	timeout = 60_000,
): Promise<void> {
	const { adminDb } = await import("~/test/pg-harness");
	try {
		await adminDb.$transaction(
			async (tx) => {
				await steps(tx, (sql, ...params) =>
					tx.$executeRawUnsafe(sql, ...params),
				);
				throw new Rollback();
			},
			{ timeout, maxWait: timeout },
		);
	} catch (error) {
		if (!(error instanceof Rollback)) throw error;
	}
}
