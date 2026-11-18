/**
 * 20261118100000_recovery_proof on real Postgres: the "recoveryHash" column,
 * what the app role may and may not do on the two key tables afterwards, that
 * the migration can run again without losing a stored hash, and that its
 * rollback snippet gives a release from before it the grants it needs while
 * keeping the column. Everything runs in a transaction that always rolls back,
 * as the owner, with `asApp` switching to retrospend_app the way
 * userTransaction does.
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

const NAME = "20261118100000_recovery_proof";
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const migration = read(`prisma/migrations/${NAME}/migration.sql`);
const rollback = read(`prisma/rollback/${NAME}.sql`);

const HASH = Buffer.alloc(32, 5);
const insertSet = (client: Client, userId: string, hash: Buffer | null) =>
	client.query(
		`INSERT INTO "protection_key_set"
		   ("userId", "kdfSalt", "kdfMemoryKiB", "kdfPasses", "publicKey", "recoveryHash", "updatedAt")
		 VALUES ($1, $2, 65536, 3, $3, $4, now())`,
		[userId, Buffer.alloc(16, 1), Buffer.alloc(32, 2), hash],
	);

async function asApp<T>(client: Client, userId: string, run: () => Promise<T>) {
	await client.query(
		`SELECT set_config('app.current_user_id', $1, true), set_config('role', 'retrospend_app', true)`,
		[userId],
	);
	try {
		return await run();
	} finally {
		await client.query("RESET ROLE");
	}
}

async function failure(client: Client, run: () => Promise<unknown>) {
	await client.query("SAVEPOINT attempt");
	try {
		await run();
	} catch (error) {
		await client.query("ROLLBACK TO SAVEPOINT attempt");
		const e = error as { code?: string; message: string };
		return { code: e.code, message: e.message };
	}
	await client.query("RELEASE SAVEPOINT attempt");
	return null;
}

const storedHash = async (client: Client, userId: string) =>
	(
		await client.query<{ h: Buffer | null }>(
			`SELECT "recoveryHash" AS h FROM "protection_key_set" WHERE "userId" = $1`,
			[userId],
		)
	).rows[0]?.h;

describe("the app role and recoveryHash", () => {
	it("reads every other column and the lock the vault write takes, and nothing of the hash", async () => {
		const { user } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			await insertSet(client, user.id, HASH);
			// The owner path reads it: without this the refusals prove nothing.
			expect(await storedHash(client, user.id)).toEqual(HASH);

			const denied = [
				`SELECT "recoveryHash" FROM "protection_key_set"`,
				`SELECT * FROM "protection_key_set"`,
				`SELECT s.* FROM "protection_key_set" s`,
				`SELECT "userId" FROM "protection_key_set" WHERE "recoveryHash" IS NOT NULL`,
				`UPDATE "protection_key_set" SET "recoveryHash" = '\\x00'::bytea`,
				`UPDATE "protection_key_set" SET "version" = 2 RETURNING "recoveryHash"`,
			];
			for (const sql of denied) {
				const refused = await asApp(client, user.id, () =>
					failure(client, () => client.query(sql)),
				);
				expect(refused?.code, sql).toBe("42501");
			}

			// What the app reads and does with the set still works.
			const own = await asApp(client, user.id, async () => {
				const read = await client.query(
					`SELECT "userId", "kdfSalt", "kdfMemoryKiB", "kdfPasses", "publicKey", "version", "createdAt", "updatedAt"
					   FROM "protection_key_set" WHERE "userId" = $1`,
					[user.id],
				);
				// The vault write's lock: needs UPDATE on some column.
				const locked = await client.query(
					`SELECT 1 AS one FROM "protection_key_set" WHERE "userId" = $1 FOR SHARE`,
					[user.id],
				);
				const count = await client.query(
					`SELECT count(*)::int AS n FROM "protection_key_set"`,
				);
				return [read.rowCount, locked.rowCount, count.rows[0].n];
			});
			expect(own).toEqual([1, 1, 1]);
		});
	});

	it("keeps the hash 32 bytes or null", async () => {
		const { user } = await createTestUser();
		const { user: other } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			for (const length of [0, 16, 31, 33, 64]) {
				const refused = await failure(client, () =>
					insertSet(client, user.id, Buffer.alloc(length, 1)),
				);
				expect(refused?.code, `${length}`).toBe("23514");
				expect(refused?.message).toContain(
					"protection_key_set_recovery_hash_check",
				);
			}
			await insertSet(client, user.id, HASH);
			await insertSet(client, other.id, null);
			expect(await storedHash(client, other.id)).toBeNull();
		});
	});
});

describe("the grants after the migration", () => {
	it("match the privilege ratchet: no INSERT on either table, no DELETE on wraps, column SELECT on the set", async () => {
		await inRolledBackTransaction(async (client) => {
			const actual = await readPrivilegeCatalog(client);
			expect(actual.tables.protection_key_set?.privileges).toEqual([]);
			expect(actual.tables.protection_key_wrap?.privileges).toEqual(["SELECT"]);
			expect(actual.columns.protection_key_set).toEqual(
				expected.columns.protection_key_set,
			);
			// The one column the app role cannot read.
			expect(actual.columns.protection_key_set?.SELECT).not.toContain(
				"recoveryHash",
			);
			expect(actual.columns.protection_key_set?.UPDATE).not.toContain(
				"recoveryHash",
			);
		});
	});
});

describe("running the migration again", () => {
	it("changes nothing and keeps a stored hash", async () => {
		const { user } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			await insertSet(client, user.id, HASH);
			const before = await readPrivilegeCatalog(client);
			await client.query(migration);
			await client.query(migration);
			expect(await readPrivilegeCatalog(client)).toEqual(before);
			expect(await storedHash(client, user.id)).toEqual(HASH);
			const { rows } = await client.query(
				`SELECT count(*)::int AS n FROM pg_constraint
				 WHERE conname = 'protection_key_set_recovery_hash_check'`,
			);
			expect(rows[0].n).toBe(1);
		});
	});
});

describe("the rollback snippet", () => {
	const record = async (client: Client) =>
		(
			await client.query<{ n: number }>(
				`SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = $1`,
				[NAME],
			)
		).rows[0]?.n;

	it("gives the app role its old grants, twice, keeps the column and its data, and the migration narrows them again", async () => {
		const { user } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			await insertSet(client, user.id, HASH);
			expect(await record(client)).toBe(1);
			await client.query(rollback);
			await client.query(rollback);

			const back = await readPrivilegeCatalog(client);
			// What a release from before this migration needs.
			expect(back.tables.protection_key_set?.privileges).toEqual([
				"INSERT",
				"SELECT",
			]);
			expect(back.tables.protection_key_wrap?.privileges).toEqual([
				"DELETE",
				"INSERT",
				"SELECT",
			]);
			expect(back.columns.protection_key_set).toEqual({
				UPDATE: expected.columns.protection_key_set.UPDATE,
			});
			// The proof of every key set made since stays.
			expect(await storedHash(client, user.id)).toEqual(HASH);
			expect(await record(client)).toBe(0);

			// The next start applies the migration again, and lands where it was.
			await client.query(migration);
			await client.query(migration);
			const again = await readPrivilegeCatalog(client);
			expect(again.tables.protection_key_set).toEqual(
				expected.tables.protection_key_set,
			);
			expect(again.tables.protection_key_wrap).toEqual(
				expected.tables.protection_key_wrap,
			);
			expect(again.columns.protection_key_set).toEqual(
				expected.columns.protection_key_set,
			);
			expect(await storedHash(client, user.id)).toEqual(HASH);
		});
	}, 60_000);

	it("leaves the app role able to read the whole set until the migration runs again", async () => {
		const { user } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			await insertSet(client, user.id, HASH);
			await client.query(rollback);
			const rows = await asApp(client, user.id, () =>
				client.query(`SELECT * FROM "protection_key_set"`),
			);
			expect(rows.rowCount).toBe(1);
		});
	});
});
