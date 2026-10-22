/**
 * Helpers for `*.pg.test.ts` files, which run against a real, freshly
 * migrated Postgres (see pg-global-setup.ts and vitest.pg.config.ts).
 *
 * `adminDb` is the app's global client: it connects as the database owner
 * and bypasses RLS, exactly like admin and system code paths in the app.
 * `createTestUser` returns the user together with `createUserScopedDb` for
 * them, so queries through `db` run as retrospend_app with RLS enforced.
 */
import { randomUUID } from "node:crypto";
import { createUserScopedDb, db } from "~/server/db";
import type { UserRole } from "~prisma";

export const adminDb = db;

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
