/**
 * The clients' keys on a real Postgres (E2EE D11 PR 3.1): what `ready()`
 * records, and the key services' caches behind it. Keystore loads are counted
 * at `keystoreDb.$transaction`, the one door both read-only loaders use.
 * Hand-derived expectations:
 *
 *   no master key            -> both classes none (master_key_missing), zero keystore calls,
 *                               and transactions on the global, scoped and user clients run
 *   grants revoked           -> user failed keystore_grants_missing; the instance loads as the
 *                               service (owner connection), so it is none; transactions run
 *   keystore schema missing  -> both failed keystore_missing; transactions run
 *   50 cold ready() calls    -> one keystore load per class, one ring for all
 *   one instance load        -> serves the read and the mint, whatever the actor
 *   no key                   -> cached 30 s, then asked again; a ring is cached 5 minutes
 *   destroyDataKeys          -> the next load asks the keystore again; a ring loaded
 *                               before the shred commits is not cached, and a
 *                               rolled-back shred only costs uncached loads
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type FieldAad,
	Keyring,
	openField,
	sealField,
} from "~/server/crypto/field-crypto";
import { type TextKeys, textKeys } from "~/server/crypto/text-keys";
import { createUserScopedDb, db } from "~/server/db";
import { buildClients, type KeySource, keystoreDb } from "~/server/db-core";
import { userTransaction } from "~/server/db-tx";
import { adminDb, createTestUser, withSuperuser } from "~/test/pg-harness";
import {
	destroyDataKeys,
	findDataKeyring,
	getOrCreateDataKeyring,
} from "./data-key.service";
import {
	evictInstanceKeyring,
	findInstanceKeyring,
	getOrCreateInstanceKeyring,
} from "./instance-key.service";
import { MISS_TTL_MS, RING_TTL_MS } from "./key-cache";

const master = () => new Keyring([{ id: 1, key: randomBytes(32) }]);
const cell: FieldAad = { table: "expense", column: "title", rowId: "e1" };

/** What db.ts wires, with a master key of the test's own (none is configured here). */
function sourceFor(mk: Keyring | undefined): KeySource {
	const instance = () => findInstanceKeyring(mk);
	return {
		instance: textKeys({ instance }),
		user: (userId) =>
			textKeys({ user: () => findDataKeyring(userId, mk), instance }),
	};
}

let keystoreCalls: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
	evictInstanceKeyring();
	await adminDb.$executeRaw`DELETE FROM keystore."instance_text_key"`;
	await adminDb.$executeRaw`UPDATE "app_settings" SET "instanceKeySince" = NULL`;
	keystoreCalls = vi.spyOn(keystoreDb, "$transaction");
});
afterEach(() => vi.restoreAllMocks());

type Clients = Pick<
	ReturnType<typeof buildClients>,
	"db" | "createUserScopedDb"
>;

/** One transaction on each client a request uses; each must still run. */
async function transactionsRun(clients: Clients, userId: string) {
	const [users] = await clients.db.$transaction([
		clients.db.user.count({ where: { id: userId } }),
	]);
	const viaCallback = await clients.db.$transaction((tx) =>
		tx.user.count({ where: { id: userId } }),
	);
	const scoped = clients.createUserScopedDb(userId);
	const viaScoped = await scoped.$transaction((tx) => tx.category.count());
	const viaModel = await scoped.category.count();
	const viaUser = await userTransaction(clients.db, userId, (tx) =>
		tx.category.count(),
	);
	expect([users, viaCallback, viaScoped, viaModel, viaUser]).toEqual([
		1, 1, 0, 0, 0,
	]);
}

async function outcomes(keys: TextKeys) {
	await keys.ready();
	return { user: keys.outcome("user"), instance: keys.outcome("instance") };
}

/** Renaming a schema needs CREATE on the database, so it runs as the superuser. */
const renameKeystore = (from: string, to: string) =>
	withSuperuser((client) =>
		client.query(`ALTER SCHEMA ${from} RENAME TO ${to}`),
	);

describe("ready() never throws", () => {
	it("records no master key without a keystore query, and the app's clients run", async () => {
		const me = await createTestUser();
		// getMasterKeyring() is undefined in the test environment.
		const raw = [
			vi.spyOn(keystoreDb, "$queryRaw"),
			vi.spyOn(keystoreDb, "$executeRaw"),
		];
		expect(await outcomes(sourceFor(undefined).user(me.user.id))).toEqual({
			user: { none: true, code: "master_key_missing" },
			instance: { none: true, code: "master_key_missing" },
		});
		await transactionsRun({ db, createUserScopedDb }, me.user.id);
		expect(keystoreCalls).not.toHaveBeenCalled();
		for (const spy of raw) expect(spy).not.toHaveBeenCalled();
	});

	it("records lost grants, and transactions still run", async () => {
		const me = await createTestUser();
		const source = sourceFor(master());
		await adminDb.$executeRawUnsafe(
			'REVOKE EXECUTE ON FUNCTION keystore."current_user_data_keys"() FROM retrospend_app',
		);
		try {
			expect(await outcomes(source.user(me.user.id))).toEqual({
				user: { failed: "keystore_grants_missing" },
				instance: { none: true },
			});
			await transactionsRun(buildClients(source), me.user.id);
		} finally {
			await adminDb.$executeRawUnsafe(
				'GRANT EXECUTE ON FUNCTION keystore."current_user_data_keys"() TO retrospend_app',
			);
		}
	});

	it("records a missing keystore, and transactions still run", async () => {
		const me = await createTestUser();
		const source = sourceFor(master());
		await renameKeystore("keystore", "keystore_gone");
		try {
			expect(await outcomes(source.user(me.user.id))).toEqual({
				user: { failed: "keystore_missing" },
				instance: { failed: "keystore_missing" },
			});
			await transactionsRun(buildClients(source), me.user.id);
		} finally {
			await renameKeystore("keystore_gone", "keystore");
		}
	});
});

describe("the key caches", () => {
	it("serves 50 cold requests with one keystore load per class", async () => {
		const mk = master();
		const me = await createTestUser();
		const own = await userTransaction(keystoreDb, me.user.id, (tx) =>
			getOrCreateDataKeyring(tx, mk),
		);
		await getOrCreateInstanceKeyring({ kind: "user", userId: me.user.id }, mk);
		evictInstanceKeyring();
		keystoreCalls.mockClear();

		const source = sourceFor(mk);
		const contexts = Array.from({ length: 50 }, () => source.user(me.user.id));
		await Promise.all(contexts.map((keys) => keys.ready()));

		expect(keystoreCalls).toHaveBeenCalledTimes(2);
		const sealed = sealField(own, "Lunch", cell);
		for (const keys of contexts) {
			expect(keys.ring("user")).toBe(contexts[0]?.ring("user"));
			expect(keys.ring("instance")).toBeInstanceOf(Keyring);
		}
		expect(openField(contexts[0]?.ring("user") as Keyring, sealed, cell)).toBe(
			"Lunch",
		);
	});

	it("shares one instance load between the read, the mint and every actor", async () => {
		const mk = master();
		const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
		const minted = await getOrCreateInstanceKeyring(
			{ kind: "user", userId: a.user.id },
			mk,
		);
		keystoreCalls.mockClear();
		const global = sourceFor(mk).instance;
		await global.ready();
		expect(global.ring("instance")).toBe(minted);
		expect(await findInstanceKeyring(mk)).toBe(minted);
		expect(keystoreCalls).not.toHaveBeenCalled();

		evictInstanceKeyring();
		const found = await findInstanceKeyring(mk);
		expect(keystoreCalls).toHaveBeenCalledTimes(1);
		expect(
			await getOrCreateInstanceKeyring({ kind: "user", userId: b.user.id }, mk),
		).toBe(found);
		expect(keystoreCalls).toHaveBeenCalledTimes(1);
	});

	it("keeps no key for 30 seconds and a ring for 5 minutes", async () => {
		const mk = master();
		const me = await createTestUser();
		const t0 = 1_000_000;
		expect(await findInstanceKeyring(mk, t0)).toBeUndefined();
		expect(await findDataKeyring(me.user.id, mk, t0)).toBeUndefined();
		expect(keystoreCalls).toHaveBeenCalledTimes(2);
		await findInstanceKeyring(mk, t0 + MISS_TTL_MS - 1);
		await findDataKeyring(me.user.id, mk, t0 + MISS_TTL_MS - 1);
		expect(keystoreCalls).toHaveBeenCalledTimes(2);

		// A key made in the meantime is seen once the 30 seconds are over.
		await userTransaction(keystoreDb, me.user.id, (tx) =>
			getOrCreateDataKeyring(tx, mk),
		);
		keystoreCalls.mockClear();
		const t1 = t0 + MISS_TTL_MS;
		const ring = await findDataKeyring(me.user.id, mk, t1);
		expect(ring).toBeInstanceOf(Keyring);
		expect(await findInstanceKeyring(mk, t1)).toBeUndefined();
		expect(keystoreCalls).toHaveBeenCalledTimes(2);

		expect(await findDataKeyring(me.user.id, mk, t1 + RING_TTL_MS - 1)).toBe(
			ring,
		);
		expect(keystoreCalls).toHaveBeenCalledTimes(2);
		await findDataKeyring(me.user.id, mk, t1 + RING_TTL_MS);
		expect(keystoreCalls).toHaveBeenCalledTimes(3);
	});

	it("drops a user's ring in this process when destroyDataKeys runs", async () => {
		const mk = master();
		const me = await createTestUser();
		await userTransaction(keystoreDb, me.user.id, (tx) =>
			getOrCreateDataKeyring(tx, mk),
		);
		keystoreCalls.mockClear();
		expect(await findDataKeyring(me.user.id, mk)).toBeInstanceOf(Keyring);
		expect(await findDataKeyring(me.user.id, mk)).toBeInstanceOf(Keyring);
		expect(keystoreCalls).toHaveBeenCalledTimes(1);

		expect(await destroyDataKeys(me.user.id)).toBe(1);
		expect(await findDataKeyring(me.user.id, mk)).toBeUndefined();
		expect(keystoreCalls).toHaveBeenCalledTimes(2);
	});

	it("does not cache a ring loaded while a shred waits to commit", async () => {
		const mk = master();
		const me = await createTestUser();
		await userTransaction(keystoreDb, me.user.id, (tx) =>
			getOrCreateDataKeyring(tx, mk),
		);
		expect(await findDataKeyring(me.user.id, mk)).toBeInstanceOf(Keyring);

		await keystoreDb.$transaction(async (tx) => {
			expect(await destroyDataKeys(me.user.id, tx)).toBe(1);
			// Another request, before the deletion commits, still finds the key.
			expect(await findDataKeyring(me.user.id, mk)).toBeInstanceOf(Keyring);
		});

		// After the commit the ring it found is not served from the cache.
		expect(await findDataKeyring(me.user.id, mk)).toBeUndefined();
	});

	it("only costs uncached loads when the deletion rolls back", async () => {
		const mk = master();
		const me = await createTestUser();
		await userTransaction(keystoreDb, me.user.id, (tx) =>
			getOrCreateDataKeyring(tx, mk),
		);
		const rollback = new Error("deletion failed");
		await expect(
			keystoreDb.$transaction(async (tx) => {
				await destroyDataKeys(me.user.id, tx);
				throw rollback;
			}),
		).rejects.toBe(rollback);
		keystoreCalls.mockClear();

		expect(await findDataKeyring(me.user.id, mk)).toBeInstanceOf(Keyring);
		expect(await findDataKeyring(me.user.id, mk)).toBeInstanceOf(Keyring);
		expect(keystoreCalls).toHaveBeenCalledTimes(2);
	});
});
