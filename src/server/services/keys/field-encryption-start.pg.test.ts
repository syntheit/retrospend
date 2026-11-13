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
import {
	expectedContactHash,
	GUEST_LABEL,
	SHADOW_LABEL,
} from "~/test/contact-hash-expected";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	inRolledBackPrismaTransaction,
	inRolledBackTransaction,
} from "~/test/rolled-back-sql";
import { instanceKeyring, resetInstanceKey } from "~/test/sealed-fixture";
import { REPO_ROOT } from "~/test/uiRules/paths";
import type { Prisma } from "~prisma";
import { contactHashTag } from "./contact-hash";
import { countMissingContactHashes, fillContactHashes } from "./contact-hash-fill";
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

const STALE = `${"0".repeat(16)}:${"0".repeat(64)}`;
const SEALED_EMAIL = "\u0001k1:AAAAAQ==";

describe("the contact hash fill and gate", () => {
	let ring: Awaited<ReturnType<typeof instanceKeyring>>;
	beforeAll(async () => {
		ring = await instanceKeyring(master);
	});
	const hash = (label: string, email: string) =>
		expectedContactHash(ring, label, email);
	const currentPrefix = () => `${contactHashTag(ring, "shadow_profile")}:`;

	async function ghost(tx: Tx, email: string | null, emailHash: string | null) {
		const owner = await createTestUser();
		const id = randomUUID();
		await tx.$executeRaw`
			INSERT INTO "shadow_profile" ("id", "createdById", "name", "email", "emailHash")
			VALUES (${id}, ${owner.user.id}, 'Ghost', ${email}, ${emailHash})`;
		return id;
	}
	async function guest(tx: Tx, email: string, emailHash: string | null) {
		const id = randomUUID();
		await tx.$executeRaw`
			INSERT INTO "guest_session"
				("id", "name", "email", "emailHash", "magicLinkId", "projectId", "sessionToken")
			VALUES (${id}, 'Guest', ${email}, ${emailHash}, 'link', 'project', ${randomUUID()})`;
		return id;
	}
	const row = async (
		tx: Tx,
		table: "shadow_profile" | "guest_session",
		id: string,
	) =>
		(
			await tx.$queryRawUnsafe<
				{ email: string | null; emailHash: string | null; updatedAt?: Date }[]
			>(`SELECT * FROM "${table}" WHERE "id" = $1`, id)
		)[0];
	/** Ghosts with a readable address and no hash of the current key. */
	const needing = async (tx: Tx) =>
		Number(
			(
				await tx.$queryRaw<{ n: bigint }[]>`
					SELECT count(*) AS "n" FROM "shadow_profile"
					WHERE "email" IS NOT NULL AND NOT starts_with("email", E'\\x01')
					  AND ("emailHash" IS NULL OR NOT starts_with("emailHash", ${currentPrefix()}))`
			)[0]?.n,
		);

	it("with the flag off and no master key, fills nothing and throws nothing", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			const id = await ghost(tx, "Bob@Example.com", null);
			expect(await start(tx, { flag: false, masterKeyring: undefined })).toBe(
				"off",
			);
			expect((await row(tx, "shadow_profile", id))?.emailHash).toBeNull();
		});
	});

	it("with the flag on and no master key, refuses before any fill and sets no epoch", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await indexAll(tx);
			const id = await ghost(tx, "Bob@Example.com", null);
			const error = await refusal(tx, { masterKeyring: undefined });
			expect(error?.code).toBe("master_key_missing");
			expect((await row(tx, "shadow_profile", id))?.emailHash).toBeNull();
			expect(await epochOf(tx)).toBeNull();
		});
	});

	it("fills legacy and stale-tag rows of both tables, leaves email bytes alone, then sets the epoch", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await indexAll(tx);
			const legacy = await ghost(tx, " Bob@Example.COM ", null);
			const stale = await ghost(tx, "stale@example.com", STALE);
			const current = await ghost(
				tx,
				"Cur@Example.com",
				hash(SHADOW_LABEL, "cur@example.com"),
			);
			const noEmail = await ghost(tx, null, null);
			const g1 = await guest(tx, "gus@example.com", null);
			const g2 = await guest(tx, "old@example.com", STALE);
			const before = await row(tx, "shadow_profile", legacy);

			expect(await start(tx)).toBe("on");

			const after = await row(tx, "shadow_profile", legacy);
			expect(after?.email).toBe(" Bob@Example.COM ");
			expect(after?.emailHash).toBe(hash(SHADOW_LABEL, "bob@example.com"));
			expect(after?.updatedAt).toEqual(before?.updatedAt);
			expect((await row(tx, "shadow_profile", stale))?.emailHash).toBe(
				hash(SHADOW_LABEL, "stale@example.com"),
			);
			expect((await row(tx, "shadow_profile", current))?.emailHash).toBe(
				hash(SHADOW_LABEL, "cur@example.com"),
			);
			expect(await row(tx, "shadow_profile", noEmail)).toMatchObject({
				email: null,
				emailHash: null,
			});
			expect((await row(tx, "guest_session", g1))?.emailHash).toBe(
				hash(GUEST_LABEL, "gus@example.com"),
			);
			expect((await row(tx, "guest_session", g2))?.emailHash).toBe(
				hash(GUEST_LABEL, "old@example.com"),
			);
			expect(await epochOf(tx)).toBeInstanceOf(Date);
		});
	});

	it("a second run updates nothing", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await indexAll(tx);
			await ghost(tx, "a@example.com", null);
			await guest(tx, "b@example.com", null);
			await start(tx);
			expect(await fillContactHashes(tx, ring, "shadow_profile")).toBe(0);
			expect(await fillContactHashes(tx, ring, "guest_session")).toBe(0);
			expect(await start(tx)).toBe("on");
		});
	});

	it("a stale tag counts as missing until the fill has made it current", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			const id = await ghost(tx, "stale@example.com", STALE);
			const g = await guest(tx, "gone@example.com", STALE);
			expect(await countMissingContactHashes(tx, ring, "shadow_profile")).toBe(1);
			expect(await countMissingContactHashes(tx, ring, "guest_session")).toBe(1);
			await fillContactHashes(tx, ring, "shadow_profile");
			await fillContactHashes(tx, ring, "guest_session");
			expect(await countMissingContactHashes(tx, ring, "shadow_profile")).toBe(0);
			expect(await countMissingContactHashes(tx, ring, "guest_session")).toBe(0);
			expect((await row(tx, "shadow_profile", id))?.emailHash).toBe(
				hash(SHADOW_LABEL, "stale@example.com"),
			);
			expect((await row(tx, "guest_session", g))?.emailHash).toBe(
				hash(GUEST_LABEL, "gone@example.com"),
			);
		});
	});

	it("refuses with contact_hash_missing for a sealed address it cannot hash, after filling the rest, and starts once it has one", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await indexAll(tx);
			const sealed = await ghost(tx, SEALED_EMAIL, STALE);
			const fillable = await ghost(tx, "fill@example.com", null);
			const error = await refusal(tx);
			expect(error?.code).toBe("contact_hash_missing");
			expect(error?.message).toMatch(/no hash/);
			// Counts per table, no address: the fillable row was made, the sealed one counts.
			expect(error?.message).toContain("shadow_profile: 1");
			expect(error?.message).not.toContain("guest_session");
			expect(error?.message).not.toContain("example.com");
			expect(await epochOf(tx)).toBeNull();
			// The fill ran before the gate.
			expect((await row(tx, "shadow_profile", fillable))?.emailHash).toBe(
				hash(SHADOW_LABEL, "fill@example.com"),
			);
			// The sealed address is left as it was.
			expect(await row(tx, "shadow_profile", sealed)).toMatchObject({
				email: SEALED_EMAIL,
				emailHash: STALE,
			});

			const made = hash(SHADOW_LABEL, "sealed@example.com");
			await tx.$executeRaw`UPDATE "shadow_profile" SET "emailHash" = ${made} WHERE "id" = ${sealed}`;
			expect(await start(tx)).toBe("on");
			expect(await epochOf(tx)).toBeInstanceOf(Date);
		});
	});

	it("a sealed guest address with no hash refuses the start too", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await indexAll(tx);
			await guest(tx, SEALED_EMAIL, null);
			const error = await refusal(tx);
			expect(error?.code).toBe("contact_hash_missing");
			expect(error?.message).toContain("guest_session: 1");
			expect(await epochOf(tx)).toBeNull();
		});
	});

	it("after a crash mid-fill the next start completes, keeps what was done and sets the epoch", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await indexAll(tx);
			for (let i = 0; i < 5; i++)
				await ghost(tx, `crash${i}@example.com`, null);
			const todo = await needing(tx);
			expect(todo).toBeGreaterThanOrEqual(5);

			let writes = 0;
			const crashing = {
				$queryRaw: tx.$queryRaw.bind(tx),
				$executeRaw: (...args: Parameters<typeof tx.$executeRaw>) => {
					if (++writes === 3) throw new Error("the server stopped");
					return tx.$executeRaw(...args);
				},
			} as unknown as Tx;
			await expect(start(crashing)).rejects.toThrow("the server stopped");

			// Two updates went through, the third never ran, no epoch.
			expect(await needing(tx)).toBe(todo - 2);
			expect(await epochOf(tx)).toBeNull();
			const done = await tx.$queryRaw<{ id: string; h: string }[]>`
				SELECT "id", "emailHash" AS "h" FROM "shadow_profile"
				WHERE starts_with("emailHash", ${currentPrefix()})`;

			expect(await start(tx)).toBe("on");
			expect(await needing(tx)).toBe(0);
			expect(await epochOf(tx)).toBeInstanceOf(Date);
			for (const { id, h } of done)
				expect((await row(tx, "shadow_profile", id))?.emailHash).toBe(h);
		});
	});

	it("skips a row whose address changed after it was read, and takes it on the next run", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			const id = await ghost(tx, "before@example.com", null);
			let raced = false;
			const racing = {
				$queryRaw: async (...args: Parameters<typeof tx.$queryRaw>) => {
					const rows = await tx.$queryRaw(...args);
					if (!raced) {
						raced = true;
						await tx.$executeRaw`UPDATE "shadow_profile" SET "email" = 'after@example.com' WHERE "id" = ${id}`;
					}
					return rows;
				},
				$executeRaw: tx.$executeRaw.bind(tx),
			} as unknown as Tx;
			await fillContactHashes(racing, ring, "shadow_profile");
			expect(await row(tx, "shadow_profile", id)).toMatchObject({
				email: "after@example.com",
				emailHash: null,
			});
			await fillContactHashes(tx, ring, "shadow_profile");
			expect((await row(tx, "shadow_profile", id))?.emailHash).toBe(
				hash(SHADOW_LABEL, "after@example.com"),
			);
		});
	});

	it("works in batches", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			const ids: string[] = [];
			for (let i = 0; i < 5; i++)
				ids.push(await ghost(tx, `batch${i}@example.com`, null));
			expect(
				await fillContactHashes(tx, ring, "shadow_profile", 2),
			).toBeGreaterThanOrEqual(5);
			expect(await needing(tx)).toBe(0);
			for (const [i, id] of ids.entries())
				expect((await row(tx, "shadow_profile", id))?.emailHash).toBe(
					hash(SHADOW_LABEL, `batch${i}@example.com`),
				);
		});
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
