/**
 * Per-user data keys (docs/roadmap/e2ee-spike.md 4.5, lane D2). Each user has
 * a random 256-bit key, stored in the `keystore` schema sealed under the
 * server master key (src/server/crypto/master-key.ts). Nothing encrypts user
 * data with it yet; D11 will.
 *
 * Callers pass the global database client. The app role has no access to the
 * keystore schema (see the migration), so a user-scoped client fails here
 * with a permission error instead of reaching a key: that is intended.
 *
 * Unwrapped keys only ever live inside a `Keyring`, which hides its bytes from
 * logs and serialization. This file logs nothing and no error names a key.
 */
import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "~prisma";
import {
	type FieldAad,
	Keyring,
	openField,
	sealField,
} from "../../crypto/field-crypto";
import { getMasterKeyring } from "../../crypto/master-key";

type Db = PrismaClient | Prisma.TransactionClient;

export type DataKeyErrorCode =
	/** DATA_MASTER_KEY is not configured, so keys cannot be sealed or opened. */
	"master_key_missing";

const MESSAGES: Record<DataKeyErrorCode, string> = {
	master_key_missing: "The server master key is not configured",
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

/** Newest first, so the first entry of the keyring is the current key. */
const readRows = (db: Db, userId: string) =>
	db.$queryRaw<KeyRow[]>`
		SELECT "keyId", "wrappedKey" FROM keystore."user_data_key"
		WHERE "userId" = ${userId}
		ORDER BY "keyId" DESC`;

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
	db: Db,
	userId: string,
	masterKeyring: Keyring | undefined = getMasterKeyring(),
): Promise<Keyring> {
	if (!masterKeyring) throw new DataKeyError("master_key_missing");
	let rows = await readRows(db, userId);
	if (rows.length === 0) {
		const wrapped = sealField(
			masterKeyring,
			randomBytes(DATA_KEY_BYTES).toString("base64"),
			wrapAad(userId, FIRST_KEY_ID),
		);
		await db.$executeRaw`
			INSERT INTO keystore."user_data_key" ("userId", "keyId", "wrappedKey", "masterKeyId")
			VALUES (${userId}, ${FIRST_KEY_ID}, ${wrapped}, ${masterKeyring.currentId})
			ON CONFLICT ("userId", "keyId") DO NOTHING`;
		rows = await readRows(db, userId);
	}
	return unwrapAll(rows, userId, masterKeyring);
}

/**
 * Crypto-shred: delete every data key the user has, and return how many.
 * Anything sealed with them can never be read again. A later
 * getOrCreateDataKeyring would make a new, unrelated key, so account deletion
 * (D3) must call this after the user can no longer write.
 */
export async function destroyDataKeys(
	db: Db,
	userId: string,
): Promise<number> {
	return db.$executeRaw`
		DELETE FROM keystore."user_data_key" WHERE "userId" = ${userId}`;
}
