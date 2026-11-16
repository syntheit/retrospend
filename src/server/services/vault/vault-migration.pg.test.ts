/**
 * The vault_record table on real Postgres (20261116100000_vault_record):
 * row-level security, the app role's narrow grants, the CHECKs that pin the
 * sealed record format, the stamping trigger, the cascade on account deletion
 * and the rollback snippet. Everything runs in a transaction that always rolls
 * back, as the owner, with `asApp` switching to retrospend_app the way
 * userTransaction does. Records are real `sealRecord` bytes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { readPrivilegeCatalog } from "~/test/migrations/privilege-catalog";
import expected from "~/test/migrations/retrospend-app-privileges.json";
import { createTestUser } from "~/test/pg-harness";
import { inRolledBackTransaction } from "~/test/rolled-back-sql";
import { REPO_ROOT } from "~/test/uiRules/paths";
import { contextOf, sealer } from "./vault-test-support";

const NAME = "20261116100000_vault_record";
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

let seal: Awaited<ReturnType<typeof sealer>>;
beforeAll(async () => {
	seal = await sealer();
});

/** A real sealed record of the smallest size (one bucket), for `userId`. */
const record = (userId: string, id: string, version = 1) =>
	Buffer.from(seal(contextOf(userId, id, version - 1)));

type Row = {
	id: string;
	collectionId: string;
	entity: number;
	version: number;
	ciphertext: Buffer | null;
	deleted: boolean;
};
const insert = (client: Client, userId: string, over: Partial<Row> = {}) => {
	const id = over.id ?? "rec1";
	const row = {
		collectionId: "col1",
		entity: 40,
		version: 1,
		deleted: false,
		...over,
		// Only sealed when no bytes were given: sealing refuses a bad id.
		ciphertext:
			over.ciphertext === undefined ? record(userId, id) : over.ciphertext,
	};
	return client.query(
		`INSERT INTO "vault_record" ("userId", "id", "collectionId", "entity", "version", "ciphertext", "deletedAt")
		 VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN now() END)`,
		[
			userId,
			id,
			row.collectionId,
			row.entity,
			row.version,
			row.ciphertext,
			row.deleted,
		],
	);
};

/** Runs `run` as the app role signed in as `userId`, then switches back. */
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
	it("hides one user's records from another, and refuses a write in their name", async () => {
		const { user: a } = await createTestUser();
		const { user: b } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			await insert(client, a.id);
			const count = () =>
				client
					.query(`SELECT count(*)::int AS n FROM "vault_record"`)
					.then((r) => r.rows[0].n as number);
			// Own rows are visible: without this the zero below proves nothing.
			expect(await asApp(client, a.id, count)).toBe(1);
			expect(await asApp(client, b.id, count)).toBe(0);

			// WITH CHECK: B cannot insert a row that belongs to A.
			const refused = await asApp(client, b.id, () =>
				failure(client, () => insert(client, a.id, { id: "rec2" })),
			);
			expect(refused?.code).toBe("42501");
			expect(refused?.message).toMatch(/row-level security/);
			// ...and B updating A's record changes nothing (USING hides the row).
			const updated = await asApp(client, b.id, () =>
				client.query(
					`UPDATE "vault_record" SET "version" = 9 WHERE "userId" = $1`,
					[a.id],
				),
			);
			expect(updated.rowCount).toBe(0);
			// A moving its row to B's id is refused by WITH CHECK as well as by the grant.
			const stolen = await asApp(client, a.id, () =>
				failure(client, () =>
					client.query(`UPDATE "vault_record" SET "userId" = $1`, [b.id]),
				),
			);
			expect(stolen?.code).toBe("42501");
		});
	});

	it("is enabled and not forced, so the owner keeps writing the table", async () => {
		await inRolledBackTransaction(async (client) => {
			const { rows } = await client.query(
				`SELECT relrowsecurity AS rls, relforcerowsecurity AS force FROM pg_class
				 WHERE relname = 'vault_record'`,
			);
			expect(rows).toEqual([{ rls: true, force: false }]);
		});
	});

	it("takes the same ids for two users: the key is (userId, id)", async () => {
		const { user: a } = await createTestUser();
		const { user: b } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			await insert(client, a.id);
			await insert(client, b.id);
			expect((await failure(client, () => insert(client, a.id)))?.code).toBe(
				"23505",
			);
		});
	});
});

describe("what the app role may do", () => {
	it("cannot change a record's owner, id, collection, entity or stamps, and cannot delete", async () => {
		const { user: a } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			await insert(client, a.id);
			const refusals = [
				`UPDATE "vault_record" SET "userId" = 'x'`,
				`UPDATE "vault_record" SET "id" = 'x'`,
				`UPDATE "vault_record" SET "collectionId" = 'other'`,
				`UPDATE "vault_record" SET "entity" = 41`,
				`UPDATE "vault_record" SET "createdAt" = now()`,
				`UPDATE "vault_record" SET "txid" = '1'::xid8`,
				`UPDATE "vault_record" SET "seq" = 1`,
				`UPDATE "vault_record" SET "updatedAt" = now()`,
				`DELETE FROM "vault_record"`,
			];
			for (const sql of refusals) {
				const refused = await asApp(client, a.id, () =>
					failure(client, () => client.query(sql)),
				);
				expect(refused?.code, sql).toBe("42501");
			}
			// The grants it does have work, so the refusals above are about the column.
			const own = await asApp(client, a.id, () =>
				client.query(
					`UPDATE "vault_record" SET "ciphertext" = $1, "version" = 2, "deletedAt" = NULL`,
					[record(a.id, "rec1", 2)],
				),
			);
			expect(own.rowCount).toBe(1);
		});
	});

	it("has no use of the sequence", async () => {
		const { user: a } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			const refused = await asApp(client, a.id, () =>
				failure(client, () =>
					client.query(`SELECT nextval('vault_record_seq')`),
				),
			);
			expect(refused?.code).toBe("42501");
		});
	});

	it("matches the privilege ratchet: table, columns and sequence", async () => {
		await inRolledBackTransaction(async (client) => {
			const actual = await readPrivilegeCatalog(client);
			expect(actual.tables.vault_record).toEqual(expected.tables.vault_record);
			expect(actual.columns.vault_record).toEqual(
				expected.columns.vault_record,
			);
			expect(actual.sequences.vault_record_seq).toEqual([]);
			expect(expected.sequences.vault_record_seq).toEqual([]);
		});
	});
});

describe("the stamping trigger", () => {
	it("overwrites what an insert names: txid, seq and updatedAt come from the database", async () => {
		const { user: a } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			await asApp(client, a.id, () =>
				client.query(
					`INSERT INTO "vault_record" ("userId", "id", "collectionId", "entity", "version", "ciphertext", "txid", "seq", "updatedAt")
					 VALUES ($1, 'rec1', 'col1', 40, 1, $2, '1'::xid8, 1, '2000-01-01')`,
					[a.id, record(a.id, "rec1")],
				),
			);
			const { rows } = await client.query(
				`SELECT ("txid" = pg_current_xact_id()) AS "ownTx", "seq" > 1 AS "seqMoved",
				        "updatedAt" > '2020-01-01' AS "timeMoved"
				 FROM "vault_record"`,
			);
			expect(rows).toEqual([{ ownTx: true, seqMoved: true, timeMoved: true }]);
		});
	});

	it("stamps again on every update: seq rises and updatedAt is set by the database", async () => {
		const { user: a } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			await insert(client, a.id);
			const seq = () =>
				client
					.query(`SELECT "seq"::bigint AS "seq" FROM "vault_record"`)
					.then((r) => BigInt(r.rows[0].seq));
			const first = await seq();
			// The owner may name updatedAt (the app role may not): the trigger still wins.
			await client.query(
				`UPDATE "vault_record" SET "version" = 2, "ciphertext" = $1, "updatedAt" = '2000-01-01'`,
				[record(a.id, "rec1", 2)],
			);
			expect(await seq()).toBeGreaterThan(first);
			const { rows } = await client.query(
				`SELECT "updatedAt" > '2020-01-01' AS "moved" FROM "vault_record"`,
			);
			expect(rows[0].moved).toBe(true);
		});
	});
});

describe("the CHECKs that pin the format", () => {
	it("accepts a real sealed record and refuses each way it can be malformed", async () => {
		const { user } = await createTestUser();
		const id = user.id;
		await inRolledBackTransaction(async (client) => {
			const good = record(id, "good");
			// The good twins first: the smallest record, an aligned larger one, the maximum.
			await insert(client, id, { id: "good" });
			await insert(client, id, {
				id: "two-buckets",
				ciphertext: Buffer.concat([good, Buffer.alloc(64, 1)]),
			});
			const max = Buffer.concat([good, Buffer.alloc(1048576 - 64, 2)]);
			expect(max.length).toBe(58 + 1048576);
			await insert(client, id, { id: "max", ciphertext: max });
			await insert(client, id, { id: "e1", entity: 1 });
			await insert(client, id, { id: "e40000", entity: 40000 });
			await insert(client, id, { id: "e65535", entity: 65535 });
			await insert(client, id, { id: "a".repeat(64) });
			await insert(client, id, { id: "Aa_-9" });
			await insert(client, id, { id: "tomb", ciphertext: null, deleted: true });

			const withHeader = (a: number, b: number) => {
				const bytes = Buffer.from(good);
				bytes[0] = a;
				bytes[1] = b;
				return bytes;
			};
			const cases: [string, Partial<Row>][] = [
				["one byte short", { ciphertext: good.subarray(0, good.length - 1) }],
				[
					"one byte long",
					{ ciphertext: Buffer.concat([good, Buffer.alloc(1)]) },
				],
				[
					"no bucket (header and tag only)",
					{ ciphertext: good.subarray(0, 58) },
				],
				["under the header", { ciphertext: good.subarray(0, 10) }],
				["empty", { ciphertext: Buffer.alloc(0) }],
				[
					"one bucket over the maximum",
					{ ciphertext: Buffer.concat([max, Buffer.alloc(64)]) },
				],
				["unknown format version", { ciphertext: withHeader(2, 1) }],
				["unknown algorithm", { ciphertext: withHeader(1, 2) }],
				["live without ciphertext", { ciphertext: null }],
				["tombstone with ciphertext", { deleted: true }],
				["entity 0", { entity: 0 }],
				["entity over 65535", { entity: 65536 }],
				["negative entity", { entity: -1 }],
				["version 0", { version: 0 }],
				["empty id", { id: "" }],
				["id over 64", { id: "a".repeat(65) }],
				["id with a slash", { id: "a/b" }],
				["id with a pipe", { id: "a|b" }],
				["empty collection", { collectionId: "" }],
				["collection over 64", { collectionId: "c".repeat(65) }],
				["collection with a space", { collectionId: "a b" }],
			];
			for (const [label, over] of cases) {
				expect(
					(
						await failure(client, () =>
							insert(client, id, { id: "bad", ciphertext: good, ...over }),
						)
					)?.code,
					label,
				).toBe("23514");
			}
		});
	});
});

describe("account deletion", () => {
	it("removes the records with the user", async () => {
		const { user } = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			await insert(client, user.id, { id: "rec1" });
			await insert(client, user.id, {
				id: "rec2",
				ciphertext: null,
				deleted: true,
			});
			await client.query(`DELETE FROM "user" WHERE "id" = $1`, [user.id]);
			const { rows } = await client.query(
				`SELECT count(*)::int AS n FROM "vault_record" WHERE "userId" = $1`,
				[user.id],
			);
			expect(rows[0].n).toBe(0);
		});
	});
});

describe("the rollback snippet", () => {
	const objects = async (client: Client) => {
		const { rows } = await client.query(`
			SELECT (SELECT count(*)::int FROM pg_class WHERE relnamespace = 'public'::regnamespace
			          AND relkind = 'r' AND relname = 'vault_record') AS tables,
			       (SELECT count(*)::int FROM pg_class WHERE relnamespace = 'public'::regnamespace
			          AND relkind = 'S' AND relname = 'vault_record_seq') AS sequences,
			       (SELECT count(*)::int FROM pg_proc WHERE proname = 'vault_record_stamp') AS functions,
			       (SELECT count(*)::int FROM pg_trigger WHERE tgname = 'vault_record_stamp' AND NOT tgisinternal) AS triggers,
			       (SELECT count(*)::int FROM pg_policy WHERE polrelid = to_regclass('public.vault_record')) AS policies,
			       (SELECT count(*)::int FROM _prisma_migrations WHERE migration_name = '${NAME}') AS record`);
		return rows[0];
	};
	const present = {
		tables: 1,
		sequences: 1,
		functions: 1,
		triggers: 1,
		policies: 1,
		record: 1,
	};
	const gone = {
		tables: 0,
		sequences: 0,
		functions: 0,
		triggers: 0,
		policies: 0,
		record: 0,
	};

	it("takes everything away, twice, and the migration brings it back, twice", async () => {
		const snippet = read(`prisma/rollback/${NAME}.sql`);
		const migration = read(`prisma/migrations/${NAME}/migration.sql`);
		await inRolledBackTransaction(async (client) => {
			expect(await objects(client)).toEqual(present);
			await client.query(snippet);
			await client.query(snippet);
			// The record goes too, so the next start applies the migration again.
			expect(await objects(client)).toEqual(gone);
			await client.query(migration);
			await client.query(migration);
			expect(await objects(client)).toEqual({ ...present, record: 0 });
			const actual = await readPrivilegeCatalog(client);
			expect(actual.tables.vault_record).toEqual(expected.tables.vault_record);
			expect(actual.columns.vault_record).toEqual(
				expected.columns.vault_record,
			);
			expect(actual.sequences.vault_record_seq).toEqual([]);
		});
	}, 60_000);

	it("refuses while a record exists, so a protected account's data is never dropped", async () => {
		const { user } = await createTestUser();
		const snippet = read(`prisma/rollback/${NAME}.sql`);
		await inRolledBackTransaction(async (client) => {
			await insert(client, user.id);
			const refused = await failure(client, () => client.query(snippet));
			expect(refused?.message).toMatch(/vault_record has rows/);
			await client.query(`DELETE FROM "vault_record"`);
			await client.query(snippet);
			expect((await objects(client)).tables).toBe(0);
		});
	}, 60_000);
});
