/**
 * Setup file for pg tests (runs in each worker before the test file loads).
 * `~/env` and `~/server/db` read process.env when first imported, so the
 * worker's database has to be in place before any test imports them.
 */
import { beforeAll, inject } from "vitest";

// Vitest numbers its workers 1..maxWorkers; the global setup cloned one
// database for each, so no two workers (and no two files at once) share one.
const poolId = Number(process.env.VITEST_POOL_ID);
const databaseUrl = inject("pgWorkerDatabaseUrls")[poolId - 1];
const superUrl = inject("pgWorkerSuperUrls")[poolId - 1];
if (!databaseUrl || !superUrl) {
	throw new Error(`No pg test database for VITEST_POOL_ID "${poolId}"`);
}
// The app's connection runs as retrospend_owner, as in production. The
// superuser's URL is there for the few tests that need it, through
// superUrl() in pg-harness.ts; nothing reads it by default.
process.env.DATABASE_URL = databaseUrl;
process.env.PG_TEST_SUPER_URL = superUrl;
// env validation requires a secret; pg tests never sign anything.
process.env.BETTER_AUTH_SECRET ??= "pg-test-placeholder-not-a-secret";

// A worker's database outlives the files it runs, and these tables are shared
// by every user in it: a rate or setting one file wrote would change the next
// file's figures. Each file starts from the template's state (all empty).
const SHARED_TABLES = ["exchange_rate", "exchange_rate_history", "app_settings"];
beforeAll(async () => {
	const { db } = await import("~/server/db");
	await db.$transaction(
		SHARED_TABLES.map((table) => db.$executeRawUnsafe(`DELETE FROM "${table}"`)),
	);
});
