/**
 * Helpers for `*.pg.test.ts` files, which run against a real, freshly
 * migrated Postgres (see pg-global-setup.ts and vitest.pg.config.ts).
 *
 * `adminDb` is the app's global client: it connects as retrospend_owner (no
 * superuser rights, BYPASSRLS), exactly like admin and system code paths in
 * the app; a test seeds user rows through `fixtureDb`. A test that needs the
 * superuser asks for `superUrl()` and opens its own connection.
 * `createTestUser` returns the user together with `createUserScopedDb` for
 * them, so queries through `db` run as retrospend_app with RLS enforced.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createUserScopedDb, db } from "~/server/db";
import { computeCategoryNameIndex } from "~/server/services/category-name-index.service";
import {
	ensureUserKeyring,
	ensureUserKeyringWhenSealing,
} from "~/server/services/keys/data-key.service";
import type { UserRole } from "~prisma";
import { fixtureClient } from "./fixture-db";

/** `PG_TEST_SEALED=1`: the whole suite runs with sealing on (sealed-sweep.ts). */
export const sealedSuite = process.env.PG_TEST_SEALED === "1";

/**
 * What a sealing write of user text for another user throws: in the sealed
 * suite it comes before the row-level security a plain write meets.
 */
export const FOREIGN_OWNER = /client's own user/;

export const adminDb = db;

/**
 * For a test's own writes and reads of user rows: `adminDb`, except that in
 * the sealed suite user rows are written and read as their owner
 * (fixture-db.ts). Never pass it to app code.
 */
export const fixtureDb = sealedSuite ? fixtureClient(db) : db;

/**
 * A category name's index for a test's own insert outside a transaction: in
 * the sealed suite as category.service stores it (a sealed name needs one),
 * otherwise null, as plain fixtures store it.
 */
export async function fixtureNameIndex(
	userId: string,
	name: string,
): Promise<string | null> {
	if (!sealedSuite) return null;
	return computeCategoryNameIndex(await ensureUserKeyring(userId), name);
}

/**
 * The superuser's URL for this worker's database. Opt in per test, with a
 * reason: the app never connects this way, so a test that does can hide a
 * privilege the owner lacks.
 */
export function superUrl(): string {
	const url = process.env.PG_TEST_SUPER_URL;
	if (!url) throw new Error("PG_TEST_SUPER_URL is not set (pg-env.ts sets it)");
	return url;
}

export async function createTestUser(options: { role?: UserRole } = {}) {
	const id = randomUUID();
	const user = await adminDb.user.create({
		data: {
			id,
			name: `Test ${id.slice(0, 8)}`,
			username: `test_${id.replaceAll("-", "")}`,
			email: `${id}@pg-test.invalid`,
			role: options.role ?? "USER",
		},
	});
	// A signed-in user's key is made before their first request's
	// transaction (trpc.ts, v1 middleware); the sealed suite's users too.
	if (sealedSuite) await ensureUserKeyringWhenSealing(id);
	return { user, db: createUserScopedDb(user.id) };
}

/** Runs `run` on a connection as the superuser; see `superUrl()`. */
export async function withSuperuser<T>(
	run: (client: Client) => Promise<T>,
): Promise<T> {
	const client = new Client({ connectionString: superUrl() });
	await client.connect();
	try {
		return await run(client);
	} finally {
		await client.end();
	}
}

/**
 * Waits until every transaction open on the Postgres server right now has
 * ended. The event outbox (events/feed.ts) releases a row only once its
 * transaction is older than every open one, server wide, so a sweep right
 * after a write waits for this first: for as long as another file's or
 * another run's transaction (a DROP DATABASE, a migration) holds it, not for
 * a fixed number of tries. After 30 s it throws and names the transactions
 * still open, so a stuck one is found by name instead of a bare test timeout.
 */
export async function openTransactionsEnded(): Promise<void> {
	const [start] = await adminDb.$queryRaw<{ xmax: string }[]>`
		SELECT pg_snapshot_xmax(pg_current_snapshot())::text AS xmax`;
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const [now] = await adminDb.$queryRaw<{ ended: boolean }[]>`
			SELECT pg_snapshot_xmin(pg_current_snapshot()) >= ${start?.xmax}::xid8 AS ended`;
		if (now?.ended) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	const open = await adminDb.$queryRaw<
		{
			pid: number;
			datname: string | null;
			xact_start: Date | null;
			state: string | null;
		}[]
	>`
		SELECT pid, datname, xact_start, state FROM pg_stat_activity
		WHERE backend_xid IS NOT NULL AND backend_xid::text::xid8 < ${start?.xmax}::xid8`;
	throw new Error(
		`transactions still open after 30 s: ${JSON.stringify(open)}`,
	);
}
