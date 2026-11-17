/**
 * The key set and the vault (E2EE F7b): a batch needs a key set that exists
 * when it commits, a reset waits for a batch in flight (the FOR SHARE in
 * writeVaultRecords) and removes the vault rows with the keys while protection
 * is OFF, and a reset that came first leaves the batch with no key set.
 * Each race holds a real transaction open, so the order is not left to timing.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetPasswordHash } from "~/server/services/account-security.service";
import { settleKeysForReset } from "~/server/services/protection-keys/password-writes";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { VaultError } from "./errors";
import { writeVaultRecords } from "./vault-api.service";
import { vaultRowsOf, wrapFixtureKey } from "./vault-db-support";
import {
	contextOf,
	KEY_ID_HEX,
	SECOND_KEY,
	SECOND_KEY_ID_HEX,
	type Sealer,
	sealer,
	writeOf,
} from "./vault-test-support";

let seal: Sealer;
const users: string[] = [];
beforeAll(async () => {
	seal = await sealer();
});
afterAll(async () => {
	await adminDb.$executeRaw`DELETE FROM "vault_record" WHERE "userId" = ANY(${users})`;
	await adminDb.protectionKeyWrap.deleteMany({
		where: { userId: { in: users } },
	});
	await adminDb.protectionKeySet.deleteMany({
		where: { userId: { in: users } },
	});
});

async function keyedUser(state: "OFF" | "ON" = "OFF") {
	const { user, db } = await createTestUser();
	users.push(user.id);
	await adminDb.protectionKeySet.create({
		data: {
			userId: user.id,
			kdfSalt: randomBytes(16),
			kdfMemoryKiB: 65536,
			kdfPasses: 3,
			publicKey: randomBytes(32),
		},
	});
	await adminDb.protectionKeyWrap.create({
		data: {
			userId: user.id,
			role: "ak-password",
			targetId: user.id,
			wrapped: Buffer.alloc(74, 1),
		},
	});
	await wrapFixtureKey(user.id);
	if (state === "ON")
		await adminDb.user.update({
			where: { id: user.id },
			data: { protectionState: "ON" },
		});
	return { id: user.id, db };
}

const wire = (userId: string, id: string, base = 0) => {
	const w = writeOf(seal, userId, id, base);
	return {
		...w,
		ciphertext: Buffer.from(w.ciphertext as Uint8Array).toString("base64url"),
	};
};

/** What turning protection on again leaves: a new key set and a collection key under a new key id. */
async function enableAgain(userId: string) {
	await adminDb.protectionKeySet.create({
		data: {
			userId,
			kdfSalt: randomBytes(16),
			kdfMemoryKiB: 65536,
			kdfPasses: 3,
			publicKey: randomBytes(32),
		},
	});
	await wrapFixtureKey(userId, SECOND_KEY_ID_HEX);
}

const keySets = (userId: string) =>
	adminDb.protectionKeySet.count({ where: { userId } });

const OFF = { hasKeySet: true, protectionState: "OFF" };

/** Waits until some backend is blocked on a lock behind another (the reset waiting for the batch). */
async function waitForLockWait(): Promise<void> {
	for (let i = 0; i < 100; i++) {
		const rows = await adminDb.$queryRaw<{ n: number }[]>`
			SELECT count(*)::int AS n FROM pg_stat_activity
			WHERE wait_event_type = 'Lock' AND datname = current_database()`;
		if ((rows[0]?.n ?? 0) > 0) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("nothing waited on a lock");
}

/** A raw owner connection that has inserted a vault row and not committed: a batch writing the same id waits behind it. */
async function holdId(userId: string, id: string) {
	const holder = new Client({ connectionString: process.env.DATABASE_URL });
	await holder.connect();
	await holder.query("BEGIN");
	await holder.query(
		`INSERT INTO "vault_record" ("userId", "id", "collectionId", "entity", "version", "ciphertext")
		 VALUES ($1, $2, 'col1', 40, 1, $3)`,
		[userId, id, Buffer.from(seal(contextOf(userId, id, 0)))],
	);
	return {
		release: async (how: "COMMIT" | "ROLLBACK") => {
			await holder.query(how);
			await holder.end();
		},
	};
}

describe("a vault batch and the key set", () => {
	it("refuses a batch for an account with no key set and stores nothing", async () => {
		const { user, db } = await createTestUser();
		users.push(user.id);
		await expect(
			writeVaultRecords(db, user.id, [wire(user.id, "a")]),
		).rejects.toMatchObject({ name: "VaultError", code: "keys_missing" });
		expect(await vaultRowsOf(user.id)).toEqual([]);
	});

	it("makes a reset wait for a batch in flight, then removes the keys and the rows the batch stored", async () => {
		const { id, db } = await keyedUser();
		// The batch takes the key set FOR SHARE first, then waits behind this row.
		const held = await holdId(id, "contended");
		const batch = writeVaultRecords(db, id, [
			wire(id, "contended"),
			wire(id, "other"),
		]);
		const batchResult = batch.then(
			(value) => ({ value }),
			(error: unknown) => ({ error }),
		);
		// Give the batch time to take its lock and block on the held id.
		await waitForLockWait();

		let resetDone = false;
		const reset = adminDb
			.$transaction((tx) => settleKeysForReset(tx, id, OFF, { kind: "email" }))
			.then(() => {
				resetDone = true;
			});
		// Two backends wait now: the batch behind the held row, the reset behind the batch's key lock.
		await new Promise((resolve) => setTimeout(resolve, 500));
		expect(resetDone).toBe(false);
		expect(await keySets(id)).toBe(1);

		// The held row's owner gives up: the batch inserts both and commits, then the reset runs.
		await held.release("ROLLBACK");
		const outcome = await batchResult;
		expect("error" in outcome ? outcome.error : null).toBeNull();
		await reset;
		expect(resetDone).toBe(true);
		expect(await keySets(id)).toBe(0);
		// The rows the batch committed before the reset ran are gone with the keys.
		expect(await vaultRowsOf(id)).toEqual([]);
	}, 30_000);

	it("leaves a batch that came after a reset began with no key set, and stores nothing", async () => {
		const { id, db } = await keyedUser();
		let releaseReset!: () => void;
		const gate = new Promise<void>((resolve) => {
			releaseReset = resolve;
		});
		let removed!: () => void;
		const keysRemoved = new Promise<void>((resolve) => {
			removed = resolve;
		});
		// The reset deletes the key set and stays open: its row lock is held.
		const reset = adminDb.$transaction(async (tx) => {
			await settleKeysForReset(tx, id, OFF, { kind: "email" });
			removed();
			await gate;
		});
		await keysRemoved;
		const batch = writeVaultRecords(db, id, [wire(id, "late")]).then(
			() => "stored",
			(error: unknown) => (error instanceof VaultError ? error.code : "other"),
		);
		await waitForLockWait();
		releaseReset();
		await reset;
		expect(await batch).toBe("keys_missing");
		expect(await vaultRowsOf(id)).toEqual([]);
	}, 30_000);
});

describe("a reset while protection is OFF", () => {
	it("deletes the account's vault rows with its keys, and no other account's", async () => {
		const a = await keyedUser();
		const b = await keyedUser();
		await writeVaultRecords(a.db, a.id, [wire(a.id, "r1"), wire(a.id, "r2")]);
		await writeVaultRecords(b.db, b.id, [wire(b.id, "r1")]);
		expect(await vaultRowsOf(a.id)).toHaveLength(2);

		const result = await adminDb.$transaction((tx) =>
			settleKeysForReset(tx, a.id, OFF, { kind: "email" }),
		);
		expect(result).toEqual({ keysRemoved: true });
		expect(await vaultRowsOf(a.id)).toEqual([]);
		expect(await keySets(a.id)).toBe(0);
		expect(await vaultRowsOf(b.id)).toHaveLength(1);
		expect(await keySets(b.id)).toBe(1);
	});

	it("deletes them through the real email reset, in the same transaction as the new hash", async () => {
		const { id, db } = await keyedUser();
		await adminDb.account.create({
			data: {
				id: randomUUID(),
				accountId: id,
				providerId: "credential",
				userId: id,
				password: "old-hash",
			},
		});
		await writeVaultRecords(db, id, [wire(id, "x1")]);
		await resetPasswordHash({
			userId: id,
			hashed: "new-hash",
			by: { kind: "email" },
			whenNoCredential: "continue",
		});
		expect(await vaultRowsOf(id)).toEqual([]);
		expect(await keySets(id)).toBe(0);
		const account = await adminDb.account.findFirstOrThrow({
			where: { userId: id, providerId: "credential" },
		});
		expect(account.password).toBe("new-hash");
	});

	it("keeps the rows when protection is on, because the reset is refused", async () => {
		const { id, db } = await keyedUser("ON");
		await writeVaultRecords(db, id, [wire(id, "keep")]);
		await expect(
			adminDb.$transaction((tx) =>
				settleKeysForReset(
					tx,
					id,
					{ hasKeySet: true, protectionState: "ON" },
					{ kind: "email" },
				),
			),
		).rejects.toThrow();
		expect(await vaultRowsOf(id)).toHaveLength(1);
		expect(await keySets(id)).toBe(1);
	});
});

describe("a device a key generation behind", () => {
	it("is refused with keys_missing after a reset and re-enable, and nothing is stored", async () => {
		const { id, db } = await keyedUser();
		await writeVaultRecords(db, id, [wire(id, "before")]);
		await adminDb.$transaction((tx) =>
			settleKeysForReset(tx, id, OFF, { kind: "email" }),
		);
		// The reset removed the keys, their wraps and the vault rows.
		expect(await keySets(id)).toBe(0);
		expect(
			await adminDb.protectionKeyWrap.count({ where: { userId: id } }),
		).toBe(0);
		expect(await vaultRowsOf(id)).toEqual([]);

		await enableAgain(id);
		expect(await keySets(id)).toBe(1);

		// The phone never saw the reset: it still seals under the first generation's key.
		await expect(
			writeVaultRecords(db, id, [wire(id, "stale"), wire(id, "stale2")]),
		).rejects.toMatchObject({ name: "VaultError", code: "keys_missing" });
		expect(await vaultRowsOf(id)).toEqual([]);
	});

	it("is refused when one record of a batch names an old key, and the good ones are not stored", async () => {
		const { id, db } = await keyedUser();
		await adminDb.$transaction((tx) =>
			settleKeysForReset(tx, id, OFF, { kind: "email" }),
		);
		await enableAgain(id);
		const fresh = writeOf(seal, id, "fresh", 0, { key: SECOND_KEY });
		const stale = writeOf(seal, id, "stale", 0);
		const asWire = (w: typeof fresh) => ({
			...w,
			ciphertext: Buffer.from(w.ciphertext as Uint8Array).toString("base64url"),
		});
		await expect(
			writeVaultRecords(db, id, [asWire(fresh), asWire(stale)]),
		).rejects.toMatchObject({ code: "keys_missing" });
		expect(await vaultRowsOf(id)).toEqual([]);
	});

	it("does not count a wrap of another role that carries the old key id", async () => {
		const { id, db } = await keyedUser();
		await adminDb.$transaction((tx) =>
			settleKeysForReset(tx, id, OFF, { kind: "email" }),
		);
		await enableAgain(id);
		await adminDb.protectionKeyWrap.create({
			data: {
				userId: id,
				role: "ak-device",
				targetId: KEY_ID_HEX,
				wrapped: Buffer.concat([Buffer.from([1, 2]), Buffer.alloc(96, 1)]),
			},
		});
		await expect(
			writeVaultRecords(db, id, [wire(id, "stale")]),
		).rejects.toMatchObject({ code: "keys_missing" });
		expect(await vaultRowsOf(id)).toEqual([]);
	});

	it("stores a create sealed under the current key, and a tombstone needs no key", async () => {
		const { id, db } = await keyedUser();
		await adminDb.$transaction((tx) =>
			settleKeysForReset(tx, id, OFF, { kind: "email" }),
		);
		await enableAgain(id);
		const current = writeOf(seal, id, "current", 0, { key: SECOND_KEY });
		const result = await writeVaultRecords(db, id, [
			{
				...current,
				ciphertext: Buffer.from(current.ciphertext as Uint8Array).toString(
					"base64url",
				),
			},
		]);
		expect(result).toEqual([{ id: "current", version: 1 }]);
		expect((await vaultRowsOf(id)).map((r) => r.id)).toEqual(["current"]);

		const gone = await writeVaultRecords(db, id, [
			{
				...writeOf(seal, id, "current", 1, { tombstone: true }),
				ciphertext: null,
			},
		]);
		expect(gone).toEqual([{ id: "current", version: 2 }]);
	});
});
