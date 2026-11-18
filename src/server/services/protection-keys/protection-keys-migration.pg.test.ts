/**
 * The protection key tables on real Postgres (20261115200000_protection_keys):
 * row-level security, the app role's narrow grants, the CHECKs that pin the
 * wrap formats, the cascade on account deletion and the rollback snippet.
 * Everything runs in a transaction that always rolls back, as the owner, with
 * `asApp` switching to retrospend_app the way userTransaction does.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENABLE_WRAP_ROLES } from "@retrospend/api-contract";
import { SYMMETRIC_ROLES } from "@retrospend/crypto";
import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { readPrivilegeCatalog } from "~/test/migrations/privilege-catalog";
import expected from "~/test/migrations/retrospend-app-privileges.json";
import { createTestUser } from "~/test/pg-harness";
import { inRolledBackTransaction } from "~/test/rolled-back-sql";
import { REPO_ROOT } from "~/test/uiRules/paths";

const NAME = "20261115200000_protection_keys";
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

/** A body with the two header bytes and the length of a real wrap. */
const wrap = (length: number, header: [number, number] = [1, 1]) =>
	Buffer.concat([Buffer.from(header), Buffer.alloc(length - 2, 7)]);
const SYMMETRIC = () => wrap(74, [1, 1]);
const SEALED = () => wrap(98, [1, 2]);
const SET = {
	salt: Buffer.alloc(16, 1),
	memory: 65_536,
	passes: 3,
	publicKey: Buffer.alloc(32, 2),
};

const insertSet = (
	client: Client,
	userId: string,
	over: Partial<typeof SET> = {},
) => {
	const s = { ...SET, ...over };
	return client.query(
		`INSERT INTO "protection_key_set"
		   ("userId", "kdfSalt", "kdfMemoryKiB", "kdfPasses", "publicKey", "updatedAt")
		 VALUES ($1, $2, $3, $4, $5, now())`,
		[userId, s.salt, s.memory, s.passes, s.publicKey],
	);
};
const insertWrap = (
	client: Client,
	userId: string,
	role: string,
	targetId: string,
	wrapped: Buffer,
) =>
	client.query(
		`INSERT INTO "protection_key_wrap" ("userId", "role", "targetId", "wrapped")
		 VALUES ($1, $2, $3, $4)`,
		[userId, role, targetId, wrapped],
	);

/** Runs `sql` as the app role signed in as `userId`, then switches back. */
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

/** The SQLSTATE and message of a statement that must fail; the transaction survives. */
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

describe("row-level security", () => {
	it("hides one user's key set and wraps from another, and refuses a write in their name", async () => {
		const { user: a } = await createTestUser();
		const { user: b } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			await insertSet(client, a.id);
			await insertWrap(client, a.id, "ak-password", a.id, SYMMETRIC());
			const count = (table: string) =>
				client
					.query(`SELECT count(*)::int AS n FROM "${table}"`)
					.then((r) => r.rows[0].n as number);

			// Own rows are visible: without this the zero below proves nothing.
			expect(await asApp(client, a.id, () => count("protection_key_set"))).toBe(
				1,
			);
			expect(
				await asApp(client, a.id, () => count("protection_key_wrap")),
			).toBe(1);
			expect(await asApp(client, b.id, () => count("protection_key_set"))).toBe(
				0,
			);
			expect(
				await asApp(client, b.id, () => count("protection_key_wrap")),
			).toBe(0);

			// WITH CHECK: B cannot insert a row that belongs to A.
			for (const run of [
				() => insertSet(client, a.id),
				() => insertWrap(client, a.id, "ak-recovery", a.id, SYMMETRIC()),
			]) {
				const refused = await asApp(client, b.id, () => failure(client, run));
				expect(refused?.code).toBe("42501");
				expect(refused?.message).toMatch(/row-level security/);
			}
			// ...and B updating A's set changes nothing (USING hides the row).
			const updated = await asApp(client, b.id, () =>
				client.query(
					`UPDATE "protection_key_set" SET "version" = 9 WHERE "userId" = $1`,
					[a.id],
				),
			);
			expect(updated.rowCount).toBe(0);
			// B deleting A's wrap removes nothing either.
			const deleted = await asApp(client, b.id, () =>
				client.query(`DELETE FROM "protection_key_wrap" WHERE "userId" = $1`, [
					a.id,
				]),
			);
			expect(deleted.rowCount).toBe(0);
		});
	});

	it("is enabled and not forced, so the owner keeps writing the tables", async () => {
		await inRolledBackTransaction(async (client) => {
			const { rows } = await client.query(
				`SELECT relname, relrowsecurity AS rls, relforcerowsecurity AS force FROM pg_class
				 WHERE relname IN ('protection_key_set', 'protection_key_wrap') ORDER BY 1`,
			);
			expect(rows).toEqual([
				{ relname: "protection_key_set", rls: true, force: false },
				{ relname: "protection_key_wrap", rls: true, force: false },
			]);
		});
	});
});

describe("what the app role may do", () => {
	it("cannot change the public key, the owner or a wrap, and cannot delete the set", async () => {
		const { user: a } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			await insertSet(client, a.id);
			await insertWrap(client, a.id, "ak-password", a.id, SYMMETRIC());
			const refusals = [
				`UPDATE "protection_key_set" SET "publicKey" = '\\x00'::bytea`,
				`UPDATE "protection_key_set" SET "userId" = 'x'`,
				`UPDATE "protection_key_set" SET "createdAt" = now()`,
				`UPDATE "protection_key_wrap" SET "wrapped" = '\\x00'::bytea`,
				`UPDATE "protection_key_wrap" SET "role" = 'ak-recovery'`,
				`UPDATE "protection_key_wrap" SET "userId" = 'x'`,
				`UPDATE "protection_key_wrap" SET "targetId" = 'x'`,
				`DELETE FROM "protection_key_set"`,
			];
			for (const sql of refusals) {
				const refused = await asApp(client, a.id, () =>
					failure(client, () => client.query(sql)),
				);
				expect(refused?.code, sql).toBe("42501");
			}
			// The grants it does have work, so the refusals above are about the column.
			const own = await asApp(client, a.id, async () => {
				const set = await client.query(
					`UPDATE "protection_key_set"
					   SET "kdfSalt" = $1, "kdfMemoryKiB" = 50000, "kdfPasses" = 2, "version" = 2, "updatedAt" = now()`,
					[Buffer.alloc(16, 9)],
				);
				const gone = await client.query(`DELETE FROM "protection_key_wrap"`);
				return [set.rowCount, gone.rowCount];
			});
			expect(own).toEqual([1, 1]);
		});
	});

	it("matches the privilege ratchet for both tables", async () => {
		await inRolledBackTransaction(async (client) => {
			const actual = await readPrivilegeCatalog(client);
			for (const table of [
				"protection_key_set",
				"protection_key_wrap",
			] as const) {
				expect(actual.tables[table]).toEqual(expected.tables[table]);
			}
			expect(actual.columns.protection_key_set).toEqual(
				expected.columns.protection_key_set,
			);
			expect(actual.columns.protection_key_wrap).toBeUndefined();
		});
	});
});

describe("the CHECKs that pin the formats", () => {
	it("stores a symmetric wrap for exactly the roles the contract and the crypto package name", async () => {
		const id = (await createTestUser()).user.id;
		await inRolledBackTransaction(async (client) => {
			expect([...ENABLE_WRAP_ROLES].sort()).toEqual(
				[...SYMMETRIC_ROLES].sort(),
			);
			for (const role of ENABLE_WRAP_ROLES) {
				// The target is the user id, so the own-target check passes and the
				// refusal can only come from the format check.
				const sealed = await failure(client, () =>
					insertWrap(client, id, role, id, SEALED()),
				);
				expect(sealed?.code, role).toBe("23514");
				expect(sealed?.message, role).toContain(
					"protection_key_wrap_format_check",
				);
				await insertWrap(client, id, role, id, SYMMETRIC());
			}
		});
	});

	it("accepts a well formed wrap of every role and refuses each way it can be malformed", async () => {
		const id = (await createTestUser()).user.id;
		const other = (await createTestUser()).user.id;
		await inRolledBackTransaction(async (client) => {
			// The good twins first: each role with its own format and target.
			await insertWrap(client, id, "ak-password", id, SYMMETRIC());
			await insertWrap(client, id, "ak-recovery", id, SYMMETRIC());
			await insertWrap(client, id, "private-key", id, SYMMETRIC());
			await insertWrap(client, id, "collection-key", "00ff00ff", SYMMETRIC());
			await insertWrap(client, id, "ak-device", "device-1", SEALED());
			await insertWrap(client, id, "ak-contact", "contact_1", SEALED());

			const cases: [string, () => Promise<unknown>][] = [
				[
					"unknown role",
					() => insertWrap(client, id, "ak-other", "t", SYMMETRIC()),
				],
				[
					"symmetric wrap as a device wrap",
					() => insertWrap(client, id, "ak-device", "d2", SYMMETRIC()),
				],
				[
					"sealed wrap as a collection key",
					() => insertWrap(client, id, "collection-key", "k2", SEALED()),
				],
				[
					"symmetric header on a sealed body",
					() => insertWrap(client, id, "ak-device", "d3", wrap(98, [1, 1])),
				],
				[
					"sealed header on a symmetric body",
					() =>
						insertWrap(client, id, "collection-key", "k3", wrap(74, [1, 2])),
				],
				[
					"unknown version byte",
					() =>
						insertWrap(client, id, "collection-key", "k4", wrap(74, [2, 1])),
				],
				[
					"short symmetric",
					() => insertWrap(client, id, "collection-key", "k5", wrap(73)),
				],
				[
					"long symmetric",
					() => insertWrap(client, id, "collection-key", "k6", wrap(75)),
				],
				[
					"short sealed",
					() => insertWrap(client, id, "ak-device", "d4", wrap(97, [1, 2])),
				],
				[
					"long sealed",
					() => insertWrap(client, id, "ak-device", "d5", wrap(99, [1, 2])),
				],
				[
					"empty",
					() => insertWrap(client, id, "collection-key", "k7", Buffer.alloc(0)),
				],
				[
					"one byte",
					() =>
						insertWrap(client, id, "collection-key", "k8", Buffer.from([1])),
				],
				[
					"empty target",
					() => insertWrap(client, id, "collection-key", "", SYMMETRIC()),
				],
				[
					"target over 64",
					() =>
						insertWrap(
							client,
							id,
							"collection-key",
							"a".repeat(65),
							SYMMETRIC(),
						),
				],
				[
					"target with a slash",
					() => insertWrap(client, id, "collection-key", "a/b", SYMMETRIC()),
				],
				[
					"target with a space",
					() => insertWrap(client, id, "ak-device", "a b", SEALED()),
				],
				[
					"AK wrap for another id",
					() =>
						insertWrap(client, id, "ak-password", "someone-else", SYMMETRIC()),
				],
				[
					"recovery wrap for another id",
					() =>
						insertWrap(client, id, "ak-recovery", "someone-else", SYMMETRIC()),
				],
				[
					"private key wrap for another id",
					() =>
						insertWrap(client, id, "private-key", "someone-else", SYMMETRIC()),
				],
			];
			for (const [label, run] of cases) {
				expect((await failure(client, run))?.code, label).toBe("23514");
			}
			// A longer target at the limit is fine, and the slot is unique per user.
			await insertWrap(
				client,
				id,
				"collection-key",
				"a".repeat(64),
				SYMMETRIC(),
			);
			expect(
				(
					await failure(client, () =>
						insertWrap(client, id, "ak-device", "device-1", SEALED()),
					)
				)?.code,
			).toBe("23505");
			// A second user may use the same slot.
			await insertWrap(client, other, "ak-device", "device-1", SEALED());
		});
	});

	it("pins the salt, the public key and the Argon2 ceiling", async () => {
		const id = (await createTestUser()).user.id;
		await inRolledBackTransaction(async (client) => {
			const cases: [string, Partial<typeof SET>][] = [
				["short salt", { salt: Buffer.alloc(15) }],
				["long salt", { salt: Buffer.alloc(17) }],
				["short public key", { publicKey: Buffer.alloc(31) }],
				["long public key", { publicKey: Buffer.alloc(33) }],
				["memory over the ceiling", { memory: 262_145 }],
				["memory zero", { memory: 0 }],
				["passes over the ceiling", { passes: 11 }],
				["passes zero", { passes: 0 }],
			];
			for (const [label, over] of cases) {
				expect(
					(await failure(client, () => insertSet(client, id, over)))?.code,
					label,
				).toBe("23514");
			}
			// The ceiling itself and a value under the service's floor are storable:
			// the floor is the service's, so raising it needs no migration.
			await insertSet(client, id, { memory: 262_144, passes: 10 });
			await client.query(`DELETE FROM "protection_key_set"`);
			await insertSet(client, id, { memory: 1_024, passes: 1 });
		});
	});
});

describe("account deletion", () => {
	it("removes the key set and every wrap with the user", async () => {
		const { user } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			await insertSet(client, user.id);
			await insertWrap(client, user.id, "ak-password", user.id, SYMMETRIC());
			await insertWrap(client, user.id, "ak-device", "d1", SEALED());
			await client.query(`DELETE FROM "user" WHERE "id" = $1`, [user.id]);
			for (const table of ["protection_key_set", "protection_key_wrap"]) {
				const { rows } = await client.query(
					`SELECT count(*)::int AS n FROM "${table}" WHERE "userId" = $1`,
					[user.id],
				);
				expect(rows[0].n, table).toBe(0);
			}
		});
	});
});

describe("the rollback snippet", () => {
	const objects = async (client: Client) => {
		const { rows } = await client.query(`
			SELECT (SELECT count(*)::int FROM pg_class WHERE relnamespace = 'public'::regnamespace
			          AND relkind = 'r' AND relname IN ('protection_key_set', 'protection_key_wrap')) AS tables,
			       (SELECT count(*)::int FROM pg_policy WHERE polrelid IN (
			          SELECT oid FROM pg_class WHERE relname IN ('protection_key_set', 'protection_key_wrap'))) AS policies,
			       (SELECT count(*)::int FROM _prisma_migrations WHERE migration_name = '${NAME}') AS record`);
		return rows[0];
	};

	it("takes both tables away, twice, and the migration brings them back, twice", async () => {
		const snippet = read(`prisma/rollback/${NAME}.sql`);
		const migration = read(`prisma/migrations/${NAME}/migration.sql`);
		await inRolledBackTransaction(async (client) => {
			expect(await objects(client)).toEqual({
				tables: 2,
				policies: 2,
				record: 1,
			});
			await client.query(snippet);
			await client.query(snippet);
			// The record goes too, so the next start applies the migration again.
			expect(await objects(client)).toEqual({
				tables: 0,
				policies: 0,
				record: 0,
			});
			await client.query(migration);
			await client.query(migration);
			expect((await objects(client)).tables).toBe(2);
			expect((await objects(client)).policies).toBe(2);
			const actual = await readPrivilegeCatalog(client);
			expect(actual.tables.protection_key_set).toEqual(
				expected.tables.protection_key_set,
			);
			expect(actual.tables.protection_key_wrap).toEqual(
				expected.tables.protection_key_wrap,
			);
			expect(actual.columns.protection_key_set).toEqual(
				expected.columns.protection_key_set,
			);
		});
	}, 60_000);

	it("refuses while a key set or a wrap exists, so a protected account is never locked out", async () => {
		const { user } = await createTestUser();
		const snippet = read(`prisma/rollback/${NAME}.sql`);
		await inRolledBackTransaction(async (client) => {
			await insertSet(client, user.id);
			const refused = await failure(client, () => client.query(snippet));
			expect(refused?.message).toMatch(/protection_key_set has rows/);
			await client.query(`DELETE FROM "protection_key_set"`);
			await insertWrap(client, user.id, "ak-device", randomUUID(), SEALED());
			const refusedWrap = await failure(client, () => client.query(snippet));
			expect(refusedWrap?.message).toMatch(/protection_key_wrap has rows/);
			await client.query(`DELETE FROM "protection_key_wrap"`);
			await client.query(snippet);
			expect((await objects(client)).tables).toBe(0);
		});
	}, 60_000);
});
