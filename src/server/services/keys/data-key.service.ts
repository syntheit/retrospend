/**
 * Per-user data keys (docs/roadmap/e2ee-spike.md 4.5, lane D2). Each user has
 * a random 256-bit key, stored in the `keystore` schema sealed under the
 * server master key (src/server/crypto/master-key.ts). Nothing encrypts user
 * data with it yet; D11 will.
 *
 * A signed-in caller reaches only its own key. `getOrCreateDataKeyring` takes
 * the transaction of a user-scoped client, for example
 * `ctx.db.$transaction((tx) => getOrCreateDataKeyring(tx))` or
 * `userTransaction(db, userId, (tx) => ...)`. That transaction runs as
 * retrospend_app with `app.current_user_id` set, and the two SECURITY DEFINER
 * functions in the keystore schema (see the migration) read that setting: the
 * caller never names a user, and with no setting they refuse. retrospend_app
 * has no privilege on the table itself. A bare `$queryRaw` on a scoped client
 * has no transaction and no setting, so it refuses too.
 *
 * `destroyDataKeys` is the other kind: it runs on the owner connection, for
 * jobs with no user in scope. It runs on the raw base (`keystoreDb`), never
 * through the client slot.
 *
 * `findDataKeyring` is the read-only load the clients use (db.ts): it never
 * mints, runs in a keystore transaction of its own before the caller's
 * transaction opens, and is cached per user in-process (key-cache.ts).
 *
 * Unwrapped keys only ever live inside a `Keyring`, which hides its bytes from
 * logs and serialization. This file logs nothing and no error names a key.
 */
import { randomBytes } from "node:crypto";
import { keystoreDb } from "~/server/db-core";
import { inTransaction, userTransaction } from "~/server/db-tx";
import type { Prisma } from "~prisma";
import {
	type FieldAad,
	FieldCryptoError,
	Keyring,
	openField,
	sealField,
} from "../../crypto/field-crypto";
import { getMasterKeyring } from "../../crypto/master-key";
import { sealing } from "../../crypto/sealing";
import { type CachedRing, cacheRing, isFresh, RING_TTL_MS } from "./key-cache";
import {
	KeystoreError,
	type KeystoreFailure,
	mapKeystoreErrors,
} from "./keystore-errors";

export type DataKeyErrorCode =
	/** DATA_MASTER_KEY is not configured, so keys cannot be sealed or opened. */
	| "master_key_missing"
	/** The keystore schema or table is gone; see "Data key backups" in docs/self-hosting.md. */
	| "keystore_missing"
	/** The transaction has no signed-in user, so there is no key to reach. */
	| "no_user"
	/** The app role lost its keystore grants, for example after a restore; see self-hosting.md. */
	| "keystore_grants_missing"
	/**
	 * The user had data keys once (`user."dataKeySince"` is set) and has none now,
	 * for example after a main dump was restored without the keystore dump.
	 * Making a new key would open nothing sealed before, so none is made; see
	 * "Data key backups" in docs/self-hosting.md.
	 */
	| "keystore_lost";

const MESSAGES: Record<DataKeyErrorCode, string> = {
	master_key_missing: "The server master key is not configured",
	keystore_missing:
		"The key store is missing from the database. See Data key backups in docs/self-hosting.md",
	no_user: "There is no signed-in user for the key store",
	keystore_grants_missing:
		"The app cannot reach the key store. Re-apply the grants in Data key backups in docs/self-hosting.md",
	keystore_lost:
		"This user's data keys were made before and are gone from the key store. See Data key backups in docs/self-hosting.md",
};

export class DataKeyError extends KeystoreError {
	declare readonly code: DataKeyErrorCode;
	constructor(code: DataKeyErrorCode) {
		super(code, MESSAGES[code]);
		this.name = "DataKeyError";
	}
}

const FIRST_KEY_ID = 1;
const DATA_KEY_BYTES = 32;

/** Binds a wrapped key to its user and version: a copy elsewhere fails to open. */
export function dataKeyAad(userId: string, keyId: number): FieldAad {
	return {
		table: "keystore.user_data_key",
		column: "wrappedKey",
		rowId: `${userId}:${keyId}`,
	};
}

type KeyRow = { userId: string; keyId: number; wrappedKey: string };

/**
 * Runs one keystore query and turns the failures a caller can act on into
 * stable errors (see keystore-errors.ts): a missing keystore, the functions
 * refusing a transaction with no signed-in user (or a user that does not
 * exist), a missing grant, and create_first_data_key refusing to replace keys
 * that were lost.
 */
const keystore = <T>(query: () => Promise<T>): Promise<T> =>
	mapKeystoreErrors(query, (failure) => {
		const code: Record<KeystoreFailure, DataKeyErrorCode> = {
			missing: "keystore_missing",
			refused: "no_user",
			grants: "keystore_grants_missing",
			lost: "keystore_lost",
		};
		return new DataKeyError(code[failure]);
	});

/** Newest first, so the first entry of the keyring is the current key. */
const readRows = (tx: Prisma.TransactionClient) =>
	keystore(
		() => tx.$queryRaw<KeyRow[]>`
			SELECT "user_id" AS "userId", "key_id" AS "keyId", "wrapped_key" AS "wrappedKey"
			FROM keystore."current_user_data_keys"()`,
	);

/** The user the transaction runs as, read the way the keystore functions do. */
async function sessionUserId(tx: Prisma.TransactionClient): Promise<string> {
	const [row] = await tx.$queryRaw<{ id: string | null }[]>`
		SELECT nullif(current_setting('app.current_user_id', true), '') AS "id"`;
	if (!row?.id) throw new DataKeyError("no_user");
	return row.id;
}

/** The AAD names the user the database returned, not one the caller chose. */
function unwrapAll(rows: KeyRow[], masterKeyring: Keyring): Keyring {
	return new Keyring(
		rows.map(({ userId, keyId, wrappedKey }) => ({
			id: keyId,
			key: Buffer.from(
				openField(masterKeyring, wrappedKey, dataKeyAad(userId, keyId)),
				"base64",
			),
		})),
	);
}

/**
 * The signed-in user's data keys as a keyring (current key first), made on
 * first use. A user that had keys and has none now gets `keystore_lost`, not a
 * new key (the function checks `user."dataKeySince"`). Safe to call from several requests at once: the insert is a no-op
 * for the loser, and everyone then reads the key that won.
 */
export async function getOrCreateDataKeyring(
	tx: Prisma.TransactionClient,
	masterKeyring: Keyring | undefined = getMasterKeyring(),
): Promise<Keyring> {
	if (!masterKeyring) throw new DataKeyError("master_key_missing");
	let rows = await readRows(tx);
	if (rows.length === 0) {
		const userId = await sessionUserId(tx);
		const wrapped = sealField(
			masterKeyring,
			randomBytes(DATA_KEY_BYTES).toString("base64"),
			dataKeyAad(userId, FIRST_KEY_ID),
		);
		rows = await keystore(
			() => tx.$queryRaw<KeyRow[]>`
				SELECT "user_id" AS "userId", "key_id" AS "keyId", "wrapped_key" AS "wrappedKey"
				FROM keystore."create_first_data_key"(${wrapped}, ${masterKeyring.currentId}::bigint)`,
		);
		// A cached "no key" would hide the new key from readers for 30 seconds.
		evictDataKeyring(userId);
	}
	return unwrapAll(rows, masterKeyring);
}

const minting = new Map<string, Promise<Keyring>>();

/**
 * The user's data keys, made now if they have none (E2EE D11 PR 4 section
 * 1): for the first write that seals, so a read, a preview or a script that
 * only reads never mints. It runs on a connection of its own, never inside
 * the caller's transaction (that would hold two pool connections at once),
 * and shares one mint per user in this process; across processes the insert
 * is a no-op for the loser. The cached ring answers first, so a user who has
 * keys costs no query. The ring is evicted after the commit, so the next
 * client load reads the new key.
 */
export function ensureUserKeyring(
	userId: string,
	masterKeyring: Keyring | undefined = getMasterKeyring(),
): Promise<Keyring> {
	if (inTransaction())
		throw new Error("ensureUserKeyring runs before a transaction, not inside");
	const running = minting.get(userId);
	if (running) return running;
	const mint = (async () => {
		const found = await findDataKeyring(userId, masterKeyring);
		if (found) return found;
		const ring = await userTransaction(keystoreDb, userId, (tx) =>
			getOrCreateDataKeyring(tx, masterKeyring),
		);
		evictDataKeyring(userId);
		return ring;
	})().finally(() => minting.delete(userId));
	minting.set(userId, mint);
	return mint;
}

/**
 * `ensureUserKeyring` when this process seals, else nothing. A key that
 * cannot be made (no master key, a lost keystore or grant) does not fail the
 * caller here: reads and writes without text still work, and the write that
 * needs the key fails closed with the recorded code. `masterKeyring` is for
 * tests: null means none.
 */
export async function ensureUserKeyringWhenSealing(
	userId: string,
	masterKeyring: Keyring | null | undefined = getMasterKeyring(),
): Promise<void> {
	if (!sealing()) return;
	try {
		await ensureUserKeyring(userId, masterKeyring ?? undefined);
	} catch (error) {
		if (!(error instanceof KeystoreError || error instanceof FieldCryptoError))
			throw error;
	}
}

const USER_CACHE_SIZE = 1000;
/** Least recently used first: a Map keeps insertion order. */
const userRings = new Map<string, CachedRing>();
/**
 * Users whose keys this process shredded, and until when none of their rings
 * is cached. A shred in a caller's transaction is final only at its commit,
 * and a load before that still finds the keys; it must not keep them for five
 * minutes. If the deletion rolls back, the user only costs uncached loads.
 */
const shredded = new Map<string, number>();

/**
 * The user's data keys as a keyring, or undefined when they have none; never
 * mints (a preview or a read must not). It runs as `userId` on its own
 * connection, before the caller's transaction, and shares one load between
 * concurrent callers. `now` is for tests.
 */
export function findDataKeyring(
	userId: string,
	masterKeyring: Keyring | undefined = getMasterKeyring(),
	now: number = Date.now(),
): Promise<Keyring | undefined> {
	if (!masterKeyring)
		return Promise.reject(new DataKeyError("master_key_missing"));
	const load = () =>
		userTransaction(keystoreDb, userId, async (tx) => {
			const rows = await readRows(tx);
			return rows.length > 0 ? unwrapAll(rows, masterKeyring) : undefined;
		});
	if ((shredded.get(userId) ?? 0) > now) return load();
	const hit = userRings.get(userId);
	userRings.delete(userId);
	const entry = isFresh(hit, masterKeyring, now)
		? hit
		: cacheRing(masterKeyring, now, load());
	userRings.set(userId, entry);
	const oldest = userRings.keys().next().value;
	if (userRings.size > USER_CACHE_SIZE && oldest !== undefined)
		userRings.delete(oldest);
	return entry.ring;
}

/** Forget the user's cached keyring, so the next load reads the keystore. */
export function evictDataKeyring(userId: string): void {
	userRings.delete(userId);
}

/**
 * Crypto-shred: delete every data key the user has, and return how many.
 * Anything sealed with them can never be read again. Only deletion and
 * rotation jobs may call this: it runs on the owner connection and takes a
 * free user id. A later getOrCreateDataKeyring would make a new, unrelated
 * key, so a deletion job calls it in the same transaction as the user delete
 * (pass that transaction as `client`, so a failed deletion keeps the keys),
 * after the user row is deleted. If a first-key insert holds the user row
 * first, the delete waits for it, then succeeds, and this call sees the
 * committed key. If the insert starts after the delete, it waits on the user
 * row and then fails. Without a `client` it runs on its own connection and
 * commits at once.
 *
 * The trigger on "user" (see the migration) also removes the keys when the
 * row goes. Account deletion has both: the trigger covers every other way a
 * user row can go, and this call states the intent in code and still works if
 * the trigger is ever changed. Both run inside the deletion transaction.
 */
export async function destroyDataKeys(
	userId: string,
	client: Pick<Prisma.TransactionClient, "$executeRaw"> = keystoreDb,
): Promise<number> {
	// This process stops caching the keys at once, and for longer than any
	// ring stays cached after the commit; other processes drop them when
	// their cache entry expires.
	const tombstone = () => {
		const now = Date.now();
		for (const [id, until] of shredded) if (until <= now) shredded.delete(id);
		shredded.set(userId, now + 2 * RING_TTL_MS);
		userRings.delete(userId);
	};
	tombstone();
	try {
		return await keystore(
			() => client.$executeRaw`
				DELETE FROM keystore."user_data_key" WHERE "userId" = ${userId}`,
		);
	} finally {
		tombstone();
	}
}

/**
 * destroyDataKeys for a deletion transaction. A missing keystore (a main dump
 * restored with no keystore dump, see Data key backups in docs/self-hosting.md)
 * means there are no keys to destroy, and it must not stop the deletion: the
 * trigger skips it the same way. The check comes first because a failed
 * statement would abort the whole transaction. It logs no user id.
 */
export async function destroyDataKeysIfStored(
	userId: string,
	client: Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">,
): Promise<number> {
	const [row] = await client.$queryRaw<{ present: boolean }[]>`
		SELECT to_regclass('keystore.user_data_key') IS NOT NULL AS "present"`;
	if (!row?.present) {
		console.warn(
			"The key store is missing, so account deletion destroyed no data keys",
		);
		return 0;
	}
	return destroyDataKeys(userId, client);
}
