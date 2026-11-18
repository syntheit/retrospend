/**
 * The reset token migration (20261118100000_reset_token_hardening) and its
 * rollback snippet on real Postgres. Everything runs in a transaction that
 * always rolls back, as the owner (src/test/rolled-back-sql.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { readPrivilegeCatalog } from "~/test/migrations/privilege-catalog";
import expected from "~/test/migrations/retrospend-app-privileges.json";
import { createTestUser } from "~/test/pg-harness";
import { inRolledBackTransaction } from "~/test/rolled-back-sql";
import { REPO_ROOT } from "~/test/uiRules/paths";

const NAME = "20261118100000_reset_token_hardening";
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const migration = () => read(`prisma/migrations/${NAME}/migration.sql`);
const snippet = () => read(`prisma/rollback/${NAME}.sql`);

const columns = async (client: Client) => {
	const { rows } = await client.query(
		`SELECT column_name AS name, is_nullable AS nullable FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name = 'password_reset_token' ORDER BY 1`,
	);
	return Object.fromEntries(
		rows.map((r) => [r.name as string, r.nullable === "YES"]),
	);
};

/** The SQLSTATE of a statement that must fail; the transaction survives. */
async function failure(client: Client, sql: string, params: unknown[] = []) {
	await client.query("SAVEPOINT attempt");
	try {
		await client.query(sql, params);
	} catch (error) {
		await client.query("ROLLBACK TO SAVEPOINT attempt");
		return (error as { code?: string }).code;
	}
	await client.query("RELEASE SAVEPOINT attempt");
	return null;
}

const insertLink = (client: Client, userId: string, origin = "email") =>
	client.query(
		`INSERT INTO "password_reset_token" ("token", "userId", "origin", "expires")
		 VALUES ($1, $2, $3, now() + interval '1 hour')`,
		[`hash-${Math.random()}`, userId, origin],
	);
const count = (client: Client) =>
	client
		.query(`SELECT count(*)::int AS n FROM "password_reset_token"`)
		.then((r) => r.rows[0].n as number);

describe("the migrated table", () => {
	it("binds a link to a user, limits the origin and goes with the account", async () => {
		const { user } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			expect(await columns(client)).toMatchObject({
				token: false,
				userId: false,
				origin: false,
				identifier: true,
			});
			await insertLink(client, user.id, "email");
			await insertLink(client, user.id, "admin");
			expect(
				await failure(
					client,
					`INSERT INTO "password_reset_token" ("token", "userId", "origin", "expires")
					 VALUES ('t1', $1, 'phone', now())`,
					[user.id],
				),
			).toBe("23514");
			expect(
				await failure(
					client,
					`INSERT INTO "password_reset_token" ("token", "userId", "origin", "expires")
					 VALUES ('t2', 'no-such-user', 'email', now())`,
				),
			).toBe("23503");
			expect(
				await failure(
					client,
					`INSERT INTO "password_reset_token" ("token", "userId", "origin", "expires")
					 VALUES ('t3', NULL, 'email', now())`,
				),
			).toBe("23502");
			await client.query(`DELETE FROM "user" WHERE "id" = $1`, [user.id]);
			expect(
				(
					await client.query(
						`SELECT count(*)::int AS n FROM "password_reset_token" WHERE "userId" = $1`,
						[user.id],
					)
				).rows[0].n,
			).toBe(0);
		});
	});

	it("stays closed to the app role, as the privilege ratchet says", async () => {
		await inRolledBackTransaction(async (client) => {
			const actual = await readPrivilegeCatalog(client);
			expect(actual.tables.password_reset_token).toEqual(
				expected.tables.password_reset_token,
			);
			expect(actual.tables.password_reset_token?.privileges).toEqual([]);
			expect(actual.columns.password_reset_token).toBeUndefined();
		});
	});
});

describe("the migration SQL", () => {
	it("deletes the pending links once and keeps the ones made after, run twice", async () => {
		const { user } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			await client.query(snippet());
			// The shape the older code wrote: an address and a raw token.
			await client.query(
				`INSERT INTO "password_reset_token" ("identifier", "token", "expires")
				 VALUES ('old@pg-test.invalid', 'raw-token', now() + interval '1 hour')`,
			);
			expect(await count(client)).toBe(1);

			await client.query(migration());
			expect(await count(client)).toBe(0);
			await insertLink(client, user.id);
			await client.query(migration());
			expect(await count(client)).toBe(1);
		});
	}, 60_000);
});

describe("the rollback snippet", () => {
	const state = async (client: Client) => {
		const { rows } = await client.query(`
			SELECT (SELECT count(*)::int FROM _prisma_migrations WHERE migration_name = '${NAME}') AS record,
			       (SELECT count(*)::int FROM pg_constraint WHERE conname IN
			          ('password_reset_token_userId_fkey', 'password_reset_token_origin_check')) AS constraints,
			       (SELECT count(*)::int FROM pg_indexes WHERE indexname = 'password_reset_token_userId_idx') AS indexes`);
		return { ...rows[0], columns: await columns(client) };
	};

	it("restores the older table, twice, and the migration brings the new one back, twice", async () => {
		await inRolledBackTransaction(async (client) => {
			const migrated = await state(client);
			expect(migrated).toMatchObject({ record: 1, constraints: 2, indexes: 1 });

			await client.query(snippet());
			await client.query(snippet());
			expect(await state(client)).toEqual({
				record: 0,
				constraints: 0,
				indexes: 0,
				columns: { expires: false, identifier: false, token: false },
			});

			await client.query(migration());
			await client.query(migration());
			expect((await state(client)).columns).toEqual(migrated.columns);
			expect(await state(client)).toMatchObject({
				constraints: 2,
				indexes: 1,
			});
		});
	}, 60_000);

	it("deletes the links it cannot keep: the older code cannot open them", async () => {
		const { user } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			await insertLink(client, user.id);
			await client.query(snippet());
			expect(await count(client)).toBe(0);
		});
	});
});
