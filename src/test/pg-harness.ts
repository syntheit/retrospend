/**
 * Helpers for `*.pg.test.ts` files, which run against a real, freshly
 * migrated Postgres (see pg-global-setup.ts and vitest.pg.config.ts).
 *
 * `adminDb` is the app's global client: it connects as retrospend_owner (no
 * superuser rights, BYPASSRLS), exactly like admin and system code paths in
 * the app. A test that needs the superuser asks for `superUrl()` and opens its
 * own connection.
 * `createTestUser` returns the user together with `createUserScopedDb` for
 * them, so queries through `db` run as retrospend_app with RLS enforced.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createUserScopedDb, db } from "~/server/db";
import type { UserRole } from "~prisma";

export const adminDb = db;

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
