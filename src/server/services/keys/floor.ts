/**
 * The rollback floor and the start gates (E2EE D11 PR 9.1, plan
 * docs/roadmap/e2ee-d11-pr9.md section 3 and its critic rounds).
 *
 * `app_settings."sealingFloor"` is the highest `SEALING_FLOOR` (release.ts)
 * of any build that started with DATA_KEYS_WRITE on. `raiseSealingFloor`
 * stores it, with GREATEST and no epoch condition, so a bump is enforced even
 * when the epoch was set long ago. A flag-off start never raises it.
 *
 * `assertStartGates` runs on every start, whatever the flag, on the owner
 * connection. Until the field encryption epoch is set nothing was sealed, so
 * no gate applies and a start behaves as it did before this file. Once it is
 * set:
 *   1. `code_below_floor`: this build's floor is lower than the stored one.
 *   2. `epoch_without_master_key`: sealed text cannot be opened without it.
 *   3. `instance_key_lost`: the instance key row is gone, its marker is null,
 *      or it does not open under the master key. This is the one state where
 *      a new key could otherwise be made silently against sealed text.
 * A user with `dataKeySince` set and no key row only counts as a warning: one
 * lost key must not take the whole instance down; that user reads
 * `keystore_lost`. A failed read stops the start (fail closed).
 *
 * Messages and details carry codes and counts only, never a name, an address
 * or an id.
 */
import type { Keyring } from "~/server/crypto/field-crypto";
import { getMasterKeyring } from "~/server/crypto/master-key";
import { SEALING_FLOOR } from "~/server/crypto/release";
import { keystoreDb } from "~/server/db-core";
import { checkInstanceKey } from "./instance-key.service";

const SETTINGS_ID = "app_settings_singleton";

export type StartGateCode =
	| "code_below_floor"
	| "epoch_without_master_key"
	| "instance_key_lost";

const MESSAGES: Record<StartGateCode, string> = {
	code_below_floor:
		"This database was sealed by a newer build than this one. Start the build that sealed it, or a newer one, and do not roll back below the sealing floor",
	epoch_without_master_key:
		"Encryption at rest was turned on for this database, so DATA_MASTER_KEY is required. Restore the original master key (or the key file) and start again",
	instance_key_lost:
		"Encryption at rest was turned on for this database and its instance key is missing from the key store or does not open. Check DATA_MASTER_KEY first, then restore the keystore dump that matches this database dump. Do not clear the marker by hand",
};

export class StartGateError extends Error {
	readonly code: StartGateCode;
	/** `detail` is counts and labels only, never an address or an id. */
	constructor(code: StartGateCode, detail?: string) {
		super(detail ? `${MESSAGES[code]} (${detail})` : MESSAGES[code]);
		this.name = "StartGateError";
		this.code = code;
	}
}

type Client = Pick<typeof keystoreDb, "$queryRaw" | "$executeRaw">;

/**
 * Stores `floor` unless the database already holds a higher one, and returns
 * what it holds now. Makes the settings row when there is none.
 */
export async function raiseSealingFloor(
	client: Client,
	floor: number = SEALING_FLOOR,
): Promise<number> {
	const [row] = await client.$queryRaw<{ floor: number }[]>`
		INSERT INTO "app_settings" ("id", "updatedAt", "sealingFloor")
		VALUES (${SETTINGS_ID}, now() AT TIME ZONE 'UTC', ${floor}::integer)
		ON CONFLICT ("id") DO UPDATE SET "sealingFloor" =
			GREATEST(COALESCE("app_settings"."sealingFloor", 0), EXCLUDED."sealingFloor")
		RETURNING "sealingFloor" AS "floor"`;
	if (row === undefined) throw new Error("The sealing floor was not stored");
	return row.floor;
}

/** Counts users whose key is gone from the key store (`keystore_lost`). */
async function countUsersWithoutKey(client: Client): Promise<number> {
	const [row] = await client.$queryRaw<{ n: bigint }[]>`
		SELECT count(*) AS "n" FROM "user" u
		WHERE u."dataKeySince" IS NOT NULL
		  AND (to_regclass('keystore.user_data_key') IS NULL
		       OR NOT EXISTS (
		         SELECT 1 FROM keystore."user_data_key" k WHERE k."userId" = u."id"))`;
	return Number(row?.n ?? 0);
}

export interface StartGateOptions {
	masterKeyring?: Keyring;
	client?: Client;
	/** This build's floor; for tests. */
	floor?: number;
}

/**
 * Runs the gates (see the file comment). Returns how many users have no key
 * (0 before the epoch, where nothing was checked); throws `StartGateError`
 * to stop the server.
 */
export async function assertStartGates({
	masterKeyring = getMasterKeyring(),
	client = keystoreDb,
	floor = SEALING_FLOOR,
}: StartGateOptions = {}): Promise<{ usersWithoutKey: number }> {
	const [row] = await client.$queryRaw<
		{ floor: number | null; epoch: boolean; instanceKey: boolean }[]
	>`
		SELECT "sealingFloor" AS "floor",
		       "fieldEncryptionSince" IS NOT NULL AS "epoch",
		       "instanceKeySince" IS NOT NULL AS "instanceKey"
		FROM "app_settings" WHERE "id" = ${SETTINGS_ID}`;
	if (!row?.epoch) return { usersWithoutKey: 0 };
	const stored = row.floor ?? 0;
	if (stored > floor)
		throw new StartGateError(
			"code_below_floor",
			`floor ${stored}, this build ${floor}`,
		);
	if (!masterKeyring) throw new StartGateError("epoch_without_master_key");
	if (!row.instanceKey)
		throw new StartGateError("instance_key_lost", "marker not set");
	const found = await checkInstanceKey(client, masterKeyring);
	if (found !== "ok")
		throw new StartGateError(
			"instance_key_lost",
			found === "missing" ? "no key row" : "key does not open",
		);
	const usersWithoutKey = await countUsersWithoutKey(client);
	if (usersWithoutKey > 0)
		console.warn(
			`Users whose data key is missing from the key store: ${usersWithoutKey}. They read keystore_lost and cannot write until it is restored`,
		);
	return { usersWithoutKey };
}
