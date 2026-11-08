/**
 * Per-user data keys (docs/roadmap/e2ee-spike.md 4.5, lane D2). Each user has
 * a random 256-bit key, stored in the `keystore` schema sealed under the
 * server master key (src/server/crypto/master-key.ts). Nothing encrypts user
 * data with it yet; D11 will.
 *
 * Every function here uses the global (owner) database client and takes no
 * client argument. The keystore is protected by what the app role is granted,
 * not by the client a caller holds: retrospend_app has no access to the schema
 * (see the migration), but a bare raw query on a user-scoped client still runs
 * on the owner connection, so a scoped client would not stop anything. Only
 * call these from server code that has already decided who the user is.
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
	| "keystore_missing";

const MESSAGES: Record<DataKeyErrorCode, string> = {
	master_key_missing: "The server master key is not configured",
	keystore_missing:
		"The key store is missing from the database. See Data key backups in docs/self-hosting.md",
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

type KeyRow = { keyId: number; wrappedKey: string };

/** Postgres 42P01 (no table) or 3F000 (no schema), as Prisma reports a failed raw query. */
function isKeystoreMissing(error: unknown): boolean {
	if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
	const meta = error.meta as
		| { driverAdapterError?: { cause?: { originalCode?: string } } }
		| undefined;
	const code = meta?.driverAdapterError?.cause?.originalCode;
	return code === "42P01" || code === "3F000";
}

/** Runs one keystore query; a missing keystore becomes a clear error. */
async function keystore<T>(query: () => Promise<T>): Promise<T> {
	try {
		return await query();
	} catch (error) {
		if (isKeystoreMissing(error)) throw new DataKeyError("keystore_missing");
		throw error;
	}
}

/** Newest first, so the first entry of the keyring is the current key. */
const readRows = (userId: string) =>
	keystore(
		() => db.$queryRaw<KeyRow[]>`
			SELECT "keyId", "wrappedKey" FROM keystore."user_data_key"
			WHERE "userId" = ${userId}
			ORDER BY "keyId" DESC`,
	);

function unwrapAll(
	rows: KeyRow[],
	userId: string,
	masterKeyring: Keyring,
): Keyring {
	return new Keyring(
		rows.map(({ keyId, wrappedKey }) => ({
			id: keyId,
			key: Buffer.from(
				openField(masterKeyring, wrappedKey, wrapAad(userId, keyId)),
				"base64",
			),
		})),
	);
}

/**
 * The user's data keys as a keyring (current key first), made on first use.
 * Safe to call from several requests at once: the insert is a no-op for the
 * loser, and everyone then reads the key that won.
 */
export async function getOrCreateDataKeyring(
	userId: string,
	masterKeyring: Keyring | undefined = getMasterKeyring(),
): Promise<Keyring> {
	if (!masterKeyring) throw new DataKeyError("master_key_missing");
	let rows = await readRows(userId);
	if (rows.length === 0) {
		const wrapped = sealField(
			masterKeyring,
			randomBytes(DATA_KEY_BYTES).toString("base64"),
			wrapAad(userId, FIRST_KEY_ID),
		);
		await keystore(
			() => db.$executeRaw`
				INSERT INTO keystore."user_data_key" ("userId", "keyId", "wrappedKey", "masterKeyId")
				VALUES (${userId}, ${FIRST_KEY_ID}, ${wrapped}, ${masterKeyring.currentId})
				ON CONFLICT ("userId", "keyId") DO NOTHING`,
		);
		rows = await readRows(userId);
	}
	return unwrapAll(rows, userId, masterKeyring);
}

/**
 * Crypto-shred: delete every data key the user has, and return how many.
 * Anything sealed with them can never be read again. A later
 * getOrCreateDataKeyring would make a new, unrelated key, so account deletion
 * (D3) must call this after the user can no longer write. Deleting the user
 * row also removes the keys (a trigger, see the migration), which is the
 * backstop for every other way a user row can go.
 */
export async function destroyDataKeys(userId: string): Promise<number> {
	return keystore(
		() => db.$executeRaw`
			DELETE FROM keystore."user_data_key" WHERE "userId" = ${userId}`,
	);
}
