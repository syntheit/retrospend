/**
 * The start-up check for DATA_KEYS_WRITE and the field encryption epoch
 * (E2EE D11 PR 4.3, docs/roadmap/e2ee-d11-pr4.md section 3, owner answer 1).
 * instrumentation.ts runs it after the master key canary and before any
 * worker. With the flag off this check runs no query and writes nothing
 * (every process still reads the epoch with its keys, epoch.ts).
 *
 * With the flag on, a server that could not seal or could store a broken
 * index stops here with an error that says what to fix, instead of failing
 * writes later (sealing fails closed, plan "Decision (PR 4.2 build)"):
 *   1. production, until sealing is released (release.ts);
 *   2. no master key: no key can be made or opened;
 *   3. the app role cannot reach the key store (a restore without the grants):
 *      every user's first sealing write would fail;
 *   4. a category without a name index: once names are sealed, the name index
 *      is what keeps them unique (D9), so its backfill must be complete.
 * Then the instance key is made, so shared text seals from the first write.
 * Then every ghost and guest address gets its hash (contact-hash-fill.ts,
 * Revision 3 PR 3a): the fill runs on every start, after the ring exists,
 * and the gate refuses the start (`contact_hash_missing`) while any address
 * lacks a hash of the current key. Only then is the epoch written. It is set
 * once and never cleared; a second start leaves the first time in place. A
 * crash anywhere before the epoch leaves nothing but hashes already made.
 *
 * Everything runs on the owner connection (`keystoreDb`): the app role has no
 * privilege on app_settings, and the nameIndex check must see every user.
 */
import { env } from "~/env";
import { markEpochActive } from "~/server/crypto/epoch";
import type { Keyring } from "~/server/crypto/field-crypto";
import { getMasterKeyring } from "~/server/crypto/master-key";
import { SEALING_RELEASED } from "~/server/crypto/release";
import { keystoreDb } from "~/server/db-core";
import { type ContactTable } from "./contact-hash";
import {
	countMissingContactHashes,
	fillContactHashes,
} from "./contact-hash-fill";
import { getOrCreateInstanceKeyring } from "./instance-key.service";

const SETTINGS_ID = "app_settings_singleton";

export type FieldEncryptionStartCode =
	| "sealing_unreleased"
	| "master_key_missing"
	| "keystore_grants_missing"
	| "category_index_missing"
	| "contact_hash_missing";

const MESSAGES: Record<FieldEncryptionStartCode, string> = {
	sealing_unreleased:
		"DATA_KEYS_WRITE is not supported in production yet. Unset it and start again",
	master_key_missing:
		"DATA_KEYS_WRITE is on but no DATA_MASTER_KEY is set. Set the master key, or unset DATA_KEYS_WRITE, and start again",
	keystore_grants_missing:
		"DATA_KEYS_WRITE is on but the app cannot reach the key store. Re-apply the grants in Data key backups in docs/self-hosting.md and start again",
	category_index_missing:
		"DATA_KEYS_WRITE is on but some categories have no name index. Run scripts/backfill-category-name-index.ts and start again",
	contact_hash_missing:
		"DATA_KEYS_WRITE is on but some contact addresses have no hash of the current key and the server could not make it. Fix or remove those rows, and start again",
};

export class FieldEncryptionStartError extends Error {
	readonly code: FieldEncryptionStartCode;
	/** `detail` is counts only, never an address or an id. */
	constructor(code: FieldEncryptionStartCode, detail?: string) {
		super(detail ? `${MESSAGES[code]} (${detail})` : MESSAGES[code]);
		this.name = "FieldEncryptionStartError";
		this.code = code;
	}
}

type Client = Pick<typeof keystoreDb, "$queryRaw" | "$executeRaw">;

/** Whether the epoch is set; the reader the clients' cache uses (db.ts). */
export async function readFieldEncryptionEpoch(
	client: Client = keystoreDb,
): Promise<boolean> {
	const [row] = await client.$queryRaw<{ set: boolean }[]>`
		SELECT "fieldEncryptionSince" IS NOT NULL AS "set"
		FROM "app_settings" WHERE "id" = ${SETTINGS_ID}`;
	return row?.set === true;
}

/**
 * Whether retrospend_app may use the key store doors the scoped clients call,
 * as prisma/grants/app-role.sql grants them. A missing role, schema or
 * function reads as false, never as an error.
 */
async function keystoreReachable(client: Client): Promise<boolean> {
	const [row] = await client.$queryRaw<{ ok: boolean | null }[]>`
		SELECT CASE
			WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'retrospend_app')
			  OR to_regnamespace('keystore') IS NULL THEN false
			ELSE pg_catalog.has_schema_privilege('retrospend_app', to_regnamespace('keystore')::oid, 'USAGE')
			 AND (SELECT bool_and(f IS NOT NULL
			                      AND pg_catalog.has_function_privilege('retrospend_app', f::oid, 'EXECUTE'))
			      FROM unnest(ARRAY[
			        to_regprocedure('keystore.current_user_data_keys()'),
			        to_regprocedure('keystore.create_first_data_key(text, bigint)'),
			        to_regprocedure('keystore.instance_text_keys()'),
			        to_regprocedure('keystore.create_first_instance_key(text, bigint)')
			      ]) AS f)
		END AS "ok"`;
	return row?.ok === true;
}

async function categoriesIndexed(client: Client): Promise<boolean> {
	const [row] = await client.$queryRaw<{ missing: boolean }[]>`
		SELECT EXISTS (SELECT 1 FROM "category" WHERE "nameIndex" IS NULL) AS "missing"`;
	return row?.missing === false;
}

const CONTACT_TABLES: readonly ContactTable[] = [
	"shadow_profile",
	"guest_session",
];

/**
 * Makes every missing contact hash, then checks that none is missing. The
 * counts go to the log, never an address or an id.
 */
async function fillContactHashesOrRefuse(
	client: Client,
	ring: Keyring,
): Promise<void> {
	for (const table of CONTACT_TABLES) {
		const filled = await fillContactHashes(client, ring, table);
		if (filled > 0) console.info(`Contact hashes filled: ${table} ${filled}`);
	}
	const missing: string[] = [];
	for (const table of CONTACT_TABLES) {
		const count = await countMissingContactHashes(client, ring, table);
		if (count > 0) missing.push(`${table}: ${count}`);
	}
	if (missing.length > 0) {
		// Rows, not addresses. The cause is not guessed: a row sealed before
		// its hash was made, or one the fill could not update, counts the same.
		const detail = `rows without a current hash, ${missing.join(", ")}`;
		console.error(`Contact hashes missing after the fill: ${detail}`);
		throw new FieldEncryptionStartError("contact_hash_missing", detail);
	}
}

export interface FieldEncryptionStartOptions {
	flag?: boolean;
	production?: boolean;
	released?: boolean;
	masterKeyring?: Keyring;
	client?: Client;
}

/**
 * Runs the check (see the file comment). Returns "off" when the flag is off
 * (nothing ran) and "on" once the epoch is set; throws
 * `FieldEncryptionStartError`, or the instance key service's error, to stop
 * the server. The options are for tests.
 */
export async function assertFieldEncryptionStart({
	flag = env.DATA_KEYS_WRITE === true,
	production = env.NODE_ENV === "production",
	released = SEALING_RELEASED,
	masterKeyring = getMasterKeyring(),
	client = keystoreDb,
}: FieldEncryptionStartOptions = {}): Promise<"off" | "on"> {
	if (!flag) return "off";
	if (production && !released)
		throw new FieldEncryptionStartError("sealing_unreleased");
	if (!masterKeyring) throw new FieldEncryptionStartError("master_key_missing");
	if (!(await keystoreReachable(client)))
		throw new FieldEncryptionStartError("keystore_grants_missing");
	if (!(await categoriesIndexed(client)))
		throw new FieldEncryptionStartError("category_index_missing");
	const ring = await getOrCreateInstanceKeyring(
		{ kind: "service" },
		masterKeyring,
	);
	await fillContactHashesOrRefuse(client, ring);
	// The conditional update keeps the first start's time; a row is made if
	// app_settings has none yet.
	await client.$executeRaw`
		INSERT INTO "app_settings" ("id", "updatedAt", "fieldEncryptionSince")
		VALUES (${SETTINGS_ID}, now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC')
		ON CONFLICT ("id") DO UPDATE SET "fieldEncryptionSince" = EXCLUDED."fieldEncryptionSince"
		WHERE "app_settings"."fieldEncryptionSince" IS NULL`;
	if (!(await readFieldEncryptionEpoch(client)))
		throw new Error("The field encryption epoch was not stored");
	markEpochActive();
	return "on";
}
