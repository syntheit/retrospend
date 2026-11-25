/**
 * The reset code migration (20261124100000_reset_code) and its rollback
 * snippet on real Postgres. Everything runs in a transaction that always rolls
 * back, as the owner (src/test/rolled-back-sql.ts).
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

const NAME = "20261124100000_reset_code";
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const migration = () => read(`prisma/migrations/${NAME}/migration.sql`);
const snippet = () => read(`prisma/rollback/${NAME}.sql`);

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

const insert = (
	client: Client,
	userId: string,
	origin: string,
	codeHash: string | null = null,
) =>
	client.query(
		`INSERT INTO "password_reset_token" ("token", "userId", "origin", "expires", "codeHash")
		 VALUES ($1, $2, $3, now() + interval '1 hour', $4)`,
		[`row-${Math.random()}`, userId, origin, codeHash],
	);
const origins = async (client: Client) =>
	(
		await client.query(
			`SELECT "origin" FROM "password_reset_token" ORDER BY 1`,
		)
	).rows.map((r) => r.origin as string);
const hasColumn = async (client: Client) =>
	(
		await client.query(
			`SELECT count(*)::int AS n FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = 'password_reset_token' AND column_name = 'codeHash'`,
		)
	).rows[0].n === 1;

const failureOf = (
	client: Client,
	userId: string,
	origin: string,
	codeHash: string | null,
) =>
	failure(
		client,
		`INSERT INTO "password_reset_token" ("token", "userId", "origin", "expires", "codeHash")
		 VALUES ($1, $2, $3, now(), $4)`,
		[`bad-${Math.random()}`, userId, origin, codeHash],
	);

describe("the migrated table", () => {
	it("takes the four origins, and a code hash on a code row only", async () => {
		const { user } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			await insert(client, user.id, "email");
			await insert(client, user.id, "admin");
			await insert(client, user.id, "phone");
			await insert(client, user.id, "code", "digest");
			expect(await origins(client)).toEqual(["admin", "code", "email", "phone"]);

			// An origin off the list, a code with no hash, and a hash on any other row.
			expect(await failureOf(client, user.id, "bogus", null)).toBe("23514");
			expect(await failureOf(client, user.id, "code", null)).toBe("23514");
			for (const origin of ["email", "admin", "phone"])
				expect(await failureOf(client, user.id, origin, "digest")).toBe(
					"23514",
				);
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
	it("keeps every row and changes nothing the second time", async () => {
		const { user } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			await insert(client, user.id, "email");
			await insert(client, user.id, "code", "digest");
			await client.query(migration());
			await client.query(migration());
			expect(await origins(client)).toEqual(["code", "email"]);
			expect(await hasColumn(client)).toBe(true);
			expect(await failureOf(client, user.id, "bogus", null)).toBe("23514");
		});
	}, 60_000);
});

describe("the rollback snippet", () => {
	it("drops the column, deletes codes and phone tokens, keeps links, and restores the older check, twice", async () => {
		const { user } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			await insert(client, user.id, "email");
			await insert(client, user.id, "admin");
			await insert(client, user.id, "phone");
			await insert(client, user.id, "code", "digest");

			await client.query(snippet());
			await client.query(snippet());
			expect(await origins(client)).toEqual(["admin", "email"]);
			expect(await hasColumn(client)).toBe(false);
			expect(
				(
					await client.query(
						`SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = '${NAME}'`,
					)
				).rows[0].n,
			).toBe(0);
			expect(
				await failure(
					client,
					`INSERT INTO "password_reset_token" ("token", "userId", "origin", "expires")
					 VALUES ('p1', $1, 'phone', now())`,
					[user.id],
				),
			).toBe("23514");

			// The migration brings it back.
			await client.query(migration());
			await client.query(migration());
			expect(await hasColumn(client)).toBe(true);
			await insert(client, user.id, "phone");
			expect(await origins(client)).toEqual(["admin", "email", "phone"]);
		});
	}, 60_000);
});
