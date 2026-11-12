/**
 * The DATA_KEYS_WRITE start-up check and the epoch (E2EE D11 PR 4.3, plan
 * section 3, owner answer 1). Each gate runs in a rolled-back transaction on
 * the owner connection, so a revoked grant, a category without a name index
 * or a written epoch never reaches the next file in this worker's database.
 * Other files leave categories with no name index (the seed computes none
 * without a master key), so the passing runs fill them in first.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	epochActiveNow,
	loadEpoch,
	resetEpochForTests,
} from "~/server/crypto/epoch";
import { Keyring } from "~/server/crypto/field-crypto";
import { createUserScopedDb } from "~/server/db";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	inRolledBackPrismaTransaction,
	inRolledBackTransaction,
} from "~/test/rolled-back-sql";
import { instanceKeyring, resetInstanceKey } from "~/test/sealed-fixture";
import { REPO_ROOT } from "~/test/uiRules/paths";
import type { Prisma } from "~prisma";
import {
	assertFieldEncryptionStart,
	type FieldEncryptionStartOptions,
	readFieldEncryptionEpoch,
} from "./field-encryption-start";
import { evictInstanceKeyring } from "./instance-key.service";

const MIGRATION = "20261111300000_field_encryption_epoch";
const master = new Keyring([{ id: 1, key: randomBytes(32) }]);

type Tx = Prisma.TransactionClient;

const epochOf = async (client: Tx) => {
	const [row] = await client.$queryRaw<{ since: Date | null }[]>`
		SELECT "fieldEncryptionSince" AS "since" FROM "app_settings"
		WHERE "id" = 'app_settings_singleton'`;
	return row?.since ?? null;
};
const indexAll = (tx: Tx) =>
	tx.$executeRaw`UPDATE "category" SET "nameIndex" = 'test-' || "id" WHERE "nameIndex" IS NULL`;
const start = (tx: Tx, options: FieldEncryptionStartOptions = {}) =>
	assertFieldEncryptionStart({
		flag: true,
		production: false,
		masterKeyring: master,
		client: tx,
		...options,
	});
const refusal = (tx: Tx, options: FieldEncryptionStartOptions = {}) =>
	start(tx, options).then(
		() => null,
		(error: unknown) => error as Error & { code?: string },
	);

beforeAll(async () => {
	await resetInstanceKey();
	// Made once, outside the rolled-back transactions: the mint writes
	// app_settings on its own connection, which would wait on their row lock.
	await instanceKeyring(master);
});
beforeEach(() => resetEpochForTests());
afterAll(async () => {
	resetEpochForTests();
	await resetInstanceKey();
});

describe("with DATA_KEYS_WRITE off", () => {
	it("starts exactly as before: no master key, no grants and no name index stop nothing, and nothing is written", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await tx.$executeRawUnsafe(
				'REVOKE EXECUTE ON FUNCTION keystore."current_user_data_keys"() FROM retrospend_app',
			);
			const u = await createTestUser();
			await tx.$executeRaw`
				INSERT INTO "category" ("id", "name", "color", "userId")
				VALUES (${randomUUID()}, 'No index', 'blue', ${u.user.id})`;
			expect(await start(tx, { flag: false, masterKeyring: undefined })).toBe(
				"off",
			);
			expect(await start(tx, { flag: false, production: true })).toBe("off");
			expect(await epochOf(tx)).toBeNull();
		});
		expect(await loadEpoch()).toBe(false);
	});
});

describe("with DATA_KEYS_WRITE on", () => {
	it("refuses to start in production while sealing is not released", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await indexAll(tx);
			const error = await refusal(tx, { production: true });
			expect(error?.code).toBe("sealing_unreleased");
			expect(error?.message).toMatch(/not supported in production/);
			expect(await epochOf(tx)).toBeNull();
			expect(await start(tx, { production: true, released: true })).toBe("on");
		});
	});

	it("refuses to start with no master key", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await indexAll(tx);
			const error = await refusal(tx, { masterKeyring: undefined });
			expect(error?.code).toBe("master_key_missing");
			expect(error?.message).toMatch(/no DATA_MASTER_KEY is set/);
			expect(await epochOf(tx)).toBeNull();
		});
	});

	it.each([
		'REVOKE EXECUTE ON FUNCTION keystore."current_user_data_keys"() FROM retrospend_app',
		'REVOKE EXECUTE ON FUNCTION keystore."create_first_data_key"(text, bigint) FROM retrospend_app',
		'REVOKE EXECUTE ON FUNCTION keystore."instance_text_keys"() FROM retrospend_app',
		'REVOKE EXECUTE ON FUNCTION keystore."create_first_instance_key"(text, bigint) FROM retrospend_app',
		"REVOKE USAGE ON SCHEMA keystore FROM retrospend_app",
		'DROP FUNCTION keystore."current_user_data_keys"()',
	])("refuses to start when the key store is out of reach: %s", async (sql) => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await indexAll(tx);
			await tx.$executeRawUnsafe(sql);
			const error = await refusal(tx);
			expect(error?.code).toBe("keystore_grants_missing");
			expect(error?.message).toMatch(/Re-apply the grants/);
			expect(await epochOf(tx)).toBeNull();
		});
	});

	it("refuses to start while any category has no name index, naming the backfill", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await indexAll(tx);
			const u = await createTestUser();
			await tx.$executeRaw`
				INSERT INTO "category" ("id", "name", "color", "userId")
				VALUES (${randomUUID()}, 'No index', 'blue', ${u.user.id})`;
			const error = await refusal(tx);
			expect(error?.code).toBe("category_index_missing");
			expect(error?.message).toContain(
				"scripts/backfill-category-name-index.ts",
			);
			expect(await epochOf(tx)).toBeNull();
		});
	});

	it("writes the epoch once: a later start keeps the first time", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await indexAll(tx);
			expect(await start(tx)).toBe("on");
			expect(await epochOf(tx)).toBeInstanceOf(Date);
			expect(epochActiveNow()).toBe(true);
			const first = new Date("2026-11-01T00:00:00Z");
			await tx.$executeRaw`UPDATE "app_settings" SET "fieldEncryptionSince" = ${first}`;
			expect(await start(tx)).toBe("on");
			expect(await epochOf(tx)).toEqual(first);
		});
	});

	it("makes the instance key when there is none yet", async () => {
		await resetInstanceKey();
		try {
			await inRolledBackPrismaTransaction(async (tx) => {
				await indexAll(tx);
				expect(await start(tx)).toBe("on");
			});
			const [row] = await adminDb.$queryRaw<{ n: bigint }[]>`
				SELECT count(*) AS "n" FROM keystore."instance_text_key"`;
			expect(row?.n).toBe(1n);
		} finally {
			evictInstanceKeyring();
			await instanceKeyring(master);
		}
	});
});

describe("the epoch reader", () => {
	it("is what every client's ready() loads, outside its transaction", async () => {
		expect(await readFieldEncryptionEpoch()).toBe(false);
		const u = await createTestUser();
		const scoped = createUserScopedDb(u.user.id);
		await scoped.$transaction(async () => {});
		expect(epochActiveNow()).toBe(false);
		await adminDb.$executeRaw`
			INSERT INTO "app_settings" ("id", "updatedAt", "fieldEncryptionSince")
			VALUES ('app_settings_singleton', now(), now())
			ON CONFLICT ("id") DO UPDATE SET "fieldEncryptionSince" = now()`;
		try {
			expect(await readFieldEncryptionEpoch()).toBe(true);
			// "Not set" is cached for 30 seconds; a fresh cache reads it again.
			resetEpochForTests();
			await scoped.$transaction(async () => {});
			expect(epochActiveNow()).toBe(true);
			expect(await loadEpoch()).toBe(true);
		} finally {
			await adminDb.$executeRaw`UPDATE "app_settings" SET "fieldEncryptionSince" = NULL`;
		}
	});
});

describe("the rollback snippet", () => {
	it("drops the column, twice, and the migration brings it back", async () => {
		const read = (dir: string, file: string) =>
			readFileSync(join(REPO_ROOT, dir, file), "utf8");
		const snippet = read("prisma/rollback", `${MIGRATION}.sql`);
		const migration = read(`prisma/migrations/${MIGRATION}`, "migration.sql");
		const columns = async (client: import("pg").Client) =>
			(
				await client.query(`
					SELECT 1 FROM pg_attribute
					 WHERE attrelid = 'app_settings'::regclass AND NOT attisdropped
					   AND attname = 'fieldEncryptionSince'`)
			).rowCount;
		await inRolledBackTransaction(async (client) => {
			expect(await columns(client)).toBe(1);
			await client.query(snippet);
			await client.query(snippet);
			expect(await columns(client)).toBe(0);
			await client.query(migration);
			await client.query(migration);
			expect(await columns(client)).toBe(1);
		});
	});
});
