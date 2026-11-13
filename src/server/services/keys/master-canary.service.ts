/**
 * The master key canary (docs/roadmap/e2ee-d11-design.md section 8, Revision 1
 * item 7). A fixed text sealed under the server master key sits in
 * `app_settings."masterKeyCanary"` (main schema; the app role has no privilege
 * on that table, so this runs on the owner connection, `keystoreDb`). At start
 * it is opened: a wrong DATA_MASTER_KEY fails the check and stops the server,
 * instead of every later key unwrap failing, or new keys being wrapped by the
 * wrong key. The first start with a master key writes it.
 *
 * Before it writes the canary for the first time it opens one wrapped key that
 * already exists (a user data key, or the instance key). An instance that made
 * keys before this release has no canary yet, and writing one under a wrong
 * master key would bless that key. With no wrapped key yet, there is nothing
 * to check against, and the canary is written as is.
 *
 * Once the field encryption epoch is set it never writes (see
 * `assertMasterKeyCanary`).
 *
 * With no master key configured the check is skipped: nothing is sealed then.
 * Any other failure (the database is unreachable, the column is missing) also
 * stops the start: an unchecked master key is the case this guards against.
 *
 * A master key rotation keeps the old entry until the rewrap job (D12) has
 * run; D12 must rewrap this value too, or dropping the old entry stops the
 * server here, which is the intended signal.
 *
 * Nothing here logs or names a key.
 */
import { keystoreDb } from "~/server/db-core";
import {
	type FieldAad,
	FieldCryptoError,
	type Keyring,
	openField,
	sealField,
} from "../../crypto/field-crypto";
import { getMasterKeyring } from "../../crypto/master-key";
import { dataKeyAad } from "./data-key.service";
import { instanceKeyAad } from "./instance-key.service";

const SETTINGS_ID = "app_settings_singleton";
/** Public and fixed: the canary proves the key, it hides nothing. */
const CANARY_TEXT = "retrospend master key canary v1";

const AAD: FieldAad = {
	table: "app_settings",
	column: "masterKeyCanary",
	rowId: SETTINGS_ID,
};

export type MasterCanaryErrorCode =
	/** The master key opens nothing sealed by the one this database was set up with. */
	"master_key_mismatch";

export class MasterCanaryError extends Error {
	readonly code: MasterCanaryErrorCode;
	constructor() {
		super(
			"DATA_MASTER_KEY does not match the key this database was set up with. Restore the original key (or the key file) and start again; see Data key backups in docs/self-hosting.md",
		);
		this.name = "MasterCanaryError";
		this.code = "master_key_mismatch";
	}
}

type CanaryClient = Pick<typeof keystoreDb, "$queryRaw" | "$executeRaw">;

const readCanary = async (client: CanaryClient): Promise<string | null> => {
	const [row] = await client.$queryRaw<{ canary: string | null }[]>`
		SELECT "masterKeyCanary" AS "canary" FROM "app_settings" WHERE "id" = ${SETTINGS_ID}`;
	return row?.canary ?? null;
};

/**
 * Opens one wrapped key that already exists, oldest first. Throws
 * `MasterCanaryError` when it does not open under this master key.
 */
async function verifyExistingKeys(
	client: CanaryClient,
	keyring: Keyring,
): Promise<void> {
	// A missing table is not an error here (a database restored without the
	// keystore); it only means there is nothing to check against.
	const [present] = await client.$queryRaw<{ user: boolean; instance: boolean }[]>`
		SELECT to_regclass('keystore.user_data_key') IS NOT NULL AS "user",
		       to_regclass('keystore.instance_text_key') IS NOT NULL AS "instance"`;
	const [user] = present?.user
		? await client.$queryRaw<
				{ userId: string; keyId: number; wrappedKey: string }[]
			>`
				SELECT "userId", "keyId", "wrappedKey" FROM keystore."user_data_key"
				ORDER BY "createdAt", "userId", "keyId" LIMIT 1`
		: [];
	const [instance] = present?.instance
		? await client.$queryRaw<{ keyId: number; wrappedKey: string }[]>`
				SELECT "keyId", "wrappedKey" FROM keystore."instance_text_key"
				ORDER BY "createdAt", "keyId" LIMIT 1`
		: [];
	try {
		if (user)
			openField(keyring, user.wrappedKey, dataKeyAad(user.userId, user.keyId));
		if (instance)
			openField(keyring, instance.wrappedKey, instanceKeyAad(instance.keyId));
	} catch (error) {
		if (error instanceof FieldCryptoError) throw new MasterCanaryError();
		throw error;
	}
}

function verify(sealed: string, keyring: Keyring): void {
	let text: string;
	try {
		text = openField(keyring, sealed, AAD);
	} catch (error) {
		// Wrong key, unknown key id, or a value that is not a canary at all.
		if (error instanceof FieldCryptoError) throw new MasterCanaryError();
		throw error;
	}
	if (text !== CANARY_TEXT) throw new MasterCanaryError();
}

/** Whether the field encryption epoch is set (sealing has been on). */
async function epochSet(client: CanaryClient): Promise<boolean> {
	const [row] = await client.$queryRaw<{ set: boolean }[]>`
		SELECT "fieldEncryptionSince" IS NOT NULL AS "set"
		FROM "app_settings" WHERE "id" = ${SETTINGS_ID}`;
	return row?.set === true;
}

/**
 * Opens the canary with the master key, writing it first when there is none.
 * Returns what it did. Throws `MasterCanaryError` on a wrong key.
 *
 * Once the epoch is set the canary only verifies, never writes: a database
 * that was sealed but lost its canary and its keystore would otherwise bind
 * whatever key is configured now, and the original key would then stop at
 * `master_key_mismatch`. It still opens an existing wrapped key, so a wrong
 * key is caught when there is one, and returns "unwritten"; the start gates
 * (floor.ts) refuse the rest.
 */
export async function assertMasterKeyCanary(
	masterKeyring: Keyring | undefined = getMasterKeyring(),
	client: CanaryClient = keystoreDb,
): Promise<"skipped" | "written" | "verified" | "unwritten"> {
	if (!masterKeyring) return "skipped";
	const existing = await readCanary(client);
	if (existing !== null) {
		verify(existing, masterKeyring);
		return "verified";
	}
	await verifyExistingKeys(client, masterKeyring);
	if (await epochSet(client)) return "unwritten";
	// The conditional update keeps the first writer's value when two servers
	// start together; both then check what is stored.
	const sealed = sealField(masterKeyring, CANARY_TEXT, AAD);
	await client.$executeRaw`
		INSERT INTO "app_settings" ("id", "updatedAt", "masterKeyCanary")
		VALUES (${SETTINGS_ID}, now() AT TIME ZONE 'UTC', ${sealed})
		ON CONFLICT ("id") DO UPDATE SET "masterKeyCanary" = EXCLUDED."masterKeyCanary"
		WHERE "app_settings"."masterKeyCanary" IS NULL`;
	const stored = await readCanary(client);
	if (stored === null) throw new Error("The master key canary was not stored");
	verify(stored, masterKeyring);
	return stored === sealed ? "written" : "verified";
}
