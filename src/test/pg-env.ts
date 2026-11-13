/**
 * Setup file for pg tests (runs in each worker before the test file loads).
 * `~/env` and `~/server/db` read process.env when first imported, so the
 * worker's database has to be in place before any test imports them.
 */
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, inject } from "vitest";
import { appPoolConfig } from "~/server/db-pool-config";
import { PrismaClient } from "~prisma";
import { guardMoneyWrites } from "./money/write-guard";

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

// The sealed suite (sealed-sweep.ts): sealing on, with a master key per
// worker database, so the keys one file mints still open in the next. The
// database name is random per run, so no run shares a key.
const sealed = process.env.PG_TEST_SEALED === "1";
if (sealed) {
	process.env.DATA_KEYS_WRITE = "true";
	process.env.DATA_MASTER_KEY = createHash("sha256")
		.update(databaseUrl)
		.digest("hex");
}

// The app's raw client, with JS numbers refused on Decimal columns
// (money/write-guard.ts). db-core builds every client on the one it finds
// here, its dev-reload cache, so the guard sits under all of them. The pool
// matches db-core's. Later files in this worker reuse it, as they did
// db-core's own client, so no file leaves a pool open.
(globalThis as { prisma?: unknown }).prisma ??= guardMoneyWrites(
	new PrismaClient({
		adapter: new PrismaPg(appPoolConfig(databaseUrl)),
	}),
);

// A worker's database outlives the files it runs, and these tables are shared
// by every user in it: a rate or setting one file wrote would change the next
// file's figures. Each file starts from the template's state (all empty).
const SHARED_TABLES = [
	"exchange_rate",
	"exchange_rate_history",
	"app_settings",
];
beforeAll(async () => {
	const { db } = await import("~/server/db");
	await db.$transaction(
		SHARED_TABLES.map((table) =>
			db.$executeRawUnsafe(`DELETE FROM "${table}"`),
		),
	);
	if (!sealed) return;
	// What the start-up check writes before the first sealing write.
	const { writeEpoch } = await import("./sealed-fixture");
	await writeEpoch(true);
	const { startSweep } = await import("./sealed-sweep");
	endSweep = await startSweep();
});

let endSweep: (() => Promise<void>) | undefined;
afterAll(() => endSweep?.());
