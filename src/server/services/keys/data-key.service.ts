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
 * jobs with no user in scope.
 *
 * Unwrapped keys only ever live inside a `Keyring`, which hides its bytes from
 * logs and serialization. This file logs nothing and no error names a key.
 */
import { randomBytes } from "node:crypto";
import { db } from "~/server/db";
import { Prisma } from "~prisma";
import {
	type FieldAad,
	Keyring,
	openField,
	sealField,
} from "../../crypto/field-crypto";
import { getMasterKeyring } from "../../crypto/master-key";

export type DataKeyErrorCode =
	/** DATA_MASTER_KEY is not configured, so keys cannot be sealed or opened. */
	| "master_key_missing"
	/** The keystore schema or table is gone; see "Data key backups" in docs/self-hosting.md. */
	| "keystore_missing"
	/** The transaction has no signed-in user, so there is no key to reach. */
	| "no_user"
	/** The app role lost its keystore grants, for example after a restore; see self-hosting.md. */
	| "keystore_grants_missing";

const MESSAGES: Record<DataKeyErrorCode, string> = {
	master_key_missing: "The server master key is not configured",
	keystore_missing:
		"The key store is missing from the database. See Data key backups in docs/self-hosting.md",
	no_user: "There is no signed-in user for the key store",
	keystore_grants_missing:
		"The app cannot reach the key store. Re-apply the grants in Data key backups in docs/self-hosting.md",
};

export class DataKeyError extends Error {
	readonly code: DataKeyErrorCode;
	constructor(code: DataKeyErrorCode) {
		super(MESSAGES[code]);
		this.name = "DataKeyError";
		this.code = code;
	}
}

const FIRST_KEY_ID = 1;
const DATA_KEY_BYTES = 32;

/** Binds a wrapped key to its user and version: a copy elsewhere fails to open. */
function wrapAad(userId: string, keyId: number): FieldAad {
	return {
		table: "keystore.user_data_key",
		column: "wrappedKey",
		rowId: `${userId}:${keyId}`,
	};
}

type KeyRow = { userId: string; keyId: number; wrappedKey: string };

/** The Postgres error code of a failed raw query, as Prisma reports it. */
function pgCode(error: unknown): string | undefined {
	if (!(error instanceof Prisma.PrismaClientKnownRequestError))
		return undefined;
	const meta = error.meta as
		| { driverAdapterError?: { cause?: { originalCode?: string } } }
		| undefined;
	return meta?.driverAdapterError?.cause?.originalCode;
}

/**
 * Runs one keystore query and turns the failures a caller can act on into
 * stable errors: 42P01 (no table), 3F000 (no schema) or 42883 (no function)
 * mean the keystore is missing; 28000 is the functions refusing a transaction
 * with no signed-in user (or a user that does not exist); 42501 is a missing
 * grant, which a restore leaves behind because the dumps carry no privileges.
 */
async function keystore<T>(query: () => Promise<T>): Promise<T> {
	try {
		return await query();
	} catch (error) {
		const code = pgCode(error);
		if (code === "42P01" || code === "3F000" || code === "42883")
			throw new DataKeyError("keystore_missing");
		if (code === "28000") throw new DataKeyError("no_user");
		if (code === "42501") throw new DataKeyError("keystore_grants_missing");
		throw error;
	}
}

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
				openField(masterKeyring, wrappedKey, wrapAad(userId, keyId)),
				"base64",
			),
		})),
	);
}

/**
 * The signed-in user's data keys as a keyring (current key first), made on
 * first use. Safe to call from several requests at once: the insert is a no-op
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
			wrapAad(userId, FIRST_KEY_ID),
		);
		rows = await keystore(
			() => tx.$queryRaw<KeyRow[]>`
				SELECT "user_id" AS "userId", "key_id" AS "keyId", "wrapped_key" AS "wrappedKey"
				FROM keystore."create_first_data_key"(${wrapped}, ${masterKeyring.currentId}::bigint)`,
		);
	}
	return unwrapAll(rows, masterKeyring);
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
	client: Pick<Prisma.TransactionClient, "$executeRaw"> = db,
): Promise<number> {
	return keystore(
		() => client.$executeRaw`
			DELETE FROM keystore."user_data_key" WHERE "userId" = ${userId}`,
	);
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
