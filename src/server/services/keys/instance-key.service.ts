/**
 * The instance key for shared text. One random 256-bit key seals text that more than one account
 * reads (shared expenses, people, projects, budget books). It lives in
 * `keystore."instance_text_key"`, wrapped by the server master key, and is read
 * through SECURITY DEFINER functions that accept one actor, the service
 * (`app.instance_service`, set on the owner connection only). retrospend_app
 * has no EXECUTE on them (migration 20261117100000_instance_key_service_only),
 * so SQL running as the app role cannot read or mint the key.
 *
 * It always runs on the raw base through `keystoreDb`, in a transaction of its
 * own, never inside a caller's transaction: a keystore call there would join
 * the caller's RLS batch or preview, and a preview must never mint.
 *
 * The clients (db.ts) load it with `findInstanceKeyring`, read-only and as the
 * service: the global client serves public pages, guests, viewer links,
 * better-auth and the workers, none of which has a per-request actor.
 *
 * The keyring is cached per process in one entry (key-cache.ts) that the read
 * and the mint share. A cache hit does not check the actor again: the check
 * guards the database door, and the caller is trusted in-process, where the
 * master key is anyway.
 *
 * Unwrapped keys only live inside a `Keyring`. This file logs nothing and no
 * error names a key.
 */
import { randomBytes } from "node:crypto";
import { keystoreDb } from "~/server/db-core";
import type { Prisma } from "~prisma";
import {
	type FieldAad,
	FieldCryptoError,
	Keyring,
	openField,
	sealField,
} from "../../crypto/field-crypto";
import { getMasterKeyring } from "../../crypto/master-key";
import { type CachedRing, cacheRing, isFresh } from "./key-cache";
import {
	KeystoreError,
	type KeystoreFailure,
	mapKeystoreErrors,
} from "./keystore-errors";

export type InstanceKeyErrorCode =
	/** DATA_MASTER_KEY is not configured, so the key cannot be sealed or opened. */
	| "master_key_missing"
	/** The keystore table or functions are gone; see "Data key backups" in docs/self-hosting.md. */
	| "keystore_missing"
	/** The database refused the service actor: the flag was set off the owner connection, or a role was in force. */
	| "no_actor"
	/** The app role lost its keystore grants, for example after a restore. */
	| "keystore_grants_missing"
	/**
	 * The instance key was made once (`app_settings."instanceKeySince"` is set)
	 * and is gone, for example after a main dump was restored without the
	 * keystore dump. A new key would open nothing sealed before, so none is made.
	 */
	| "keystore_lost";

const MESSAGES: Record<InstanceKeyErrorCode, string> = {
	master_key_missing: "The server master key is not configured",
	keystore_missing:
		"The key store is missing from the database. See Data key backups in docs/self-hosting.md",
	no_actor: "The key store refused the service actor",
	keystore_grants_missing:
		"The app cannot reach the key store. Re-apply the grants in Data key backups in docs/self-hosting.md",
	keystore_lost:
		"The instance key was made before and is gone from the key store. See Data key backups in docs/self-hosting.md",
};

export class InstanceKeyError extends KeystoreError {
	declare readonly code: InstanceKeyErrorCode;
	constructor(code: InstanceKeyErrorCode) {
		super(code, MESSAGES[code]);
		this.name = "InstanceKeyError";
	}
}

const FIRST_KEY_ID = 1;
const INSTANCE_KEY_BYTES = 32;

/** Binds a wrapped key to its version: a copy under another id fails to open. */
export function instanceKeyAad(keyId: number): FieldAad {
	return {
		table: "keystore.instance_text_key",
		column: "wrappedKey",
		rowId: String(keyId),
	};
}

type KeyRow = { keyId: number; wrappedKey: string };

/** See keystore-errors.ts: the failures a caller can act on become stable errors. */
const keystore = <T>(query: () => Promise<T>): Promise<T> =>
	mapKeystoreErrors(query, (failure) => {
		const code: Record<KeystoreFailure, InstanceKeyErrorCode> = {
			missing: "keystore_missing",
			refused: "no_actor",
			grants: "keystore_grants_missing",
			lost: "keystore_lost",
		};
		return new InstanceKeyError(code[failure]);
	});

function unwrapAll(rows: KeyRow[], masterKeyring: Keyring): Keyring {
	return new Keyring(
		rows.map(({ keyId, wrappedKey }) => ({
			id: keyId,
			key: Buffer.from(
				openField(masterKeyring, wrappedKey, instanceKeyAad(keyId)),
				"base64",
			),
		})),
	);
}

/**
 * Runs `work` in one keystore transaction as the service actor. The database
 * accepts it on the owner connection alone (no role set), so a scoped query
 * or a userTransaction cannot use it by mistake.
 */
function asService<T>(
	work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	return keystoreDb.$transaction(async (tx) => {
		await tx.$executeRaw`SELECT set_config('app.instance_service', 'on', true)`;
		return work(tx);
	});
}

/** Newest first, so the first row is the current key. */
const readRows = (tx: Prisma.TransactionClient) =>
	tx.$queryRaw<KeyRow[]>`
		SELECT "key_id" AS "keyId", "wrapped_key" AS "wrappedKey"
		FROM keystore."instance_text_keys"()`;

async function find(masterKeyring: Keyring): Promise<Keyring | undefined> {
	const rows = await keystore(() => asService(readRows));
	return rows.length > 0 ? unwrapAll(rows, masterKeyring) : undefined;
}

async function loadOrMint(masterKeyring: Keyring): Promise<Keyring> {
	const rows = await keystore(() =>
		asService(async (tx) => {
			const found = await readRows(tx);
			if (found.length > 0) return found;
			const wrapped = sealField(
				masterKeyring,
				randomBytes(INSTANCE_KEY_BYTES).toString("base64"),
				instanceKeyAad(FIRST_KEY_ID),
			);
			// Two processes that mint together end up with one key: ON CONFLICT
			// keeps the first row, and both read it back.
			return tx.$queryRaw<KeyRow[]>`
				SELECT "key_id" AS "keyId", "wrapped_key" AS "wrappedKey"
				FROM keystore."create_first_instance_key"(${wrapped}, ${masterKeyring.currentId}::bigint)`;
		}),
	);
	return unwrapAll(rows, masterKeyring);
}

/** The one process cache: the read and the mint share it. */
let cached: CachedRing | undefined;

/**
 * The instance keyring, or undefined when none was made yet; never mints. It
 * asks as the service actor and concurrent callers share one load. `now` is for tests.
 */
export function findInstanceKeyring(
	masterKeyring: Keyring | undefined = getMasterKeyring(),
	now: number = Date.now(),
): Promise<Keyring | undefined> {
	if (!masterKeyring)
		return Promise.reject(new InstanceKeyError("master_key_missing"));
	if (!isFresh(cached, masterKeyring, now))
		cached = cacheRing(masterKeyring, now, find(masterKeyring));
	return cached.ring;
}

/**
 * The instance keyring (current key first), made on first use. Safe to call
 * from many requests at once. A cached keyring is returned as it is; a cached
 * "no key", or a cached failure, is not trusted: this call loads or mints
 * for itself. `now` is for tests.
 */
export async function getOrCreateInstanceKeyring(
	masterKeyring: Keyring | undefined = getMasterKeyring(),
	now: number = Date.now(),
): Promise<Keyring> {
	if (!masterKeyring) throw new InstanceKeyError("master_key_missing");
	if (isFresh(cached, masterKeyring, now)) {
		const found = await cached.ring.catch(() => undefined);
		if (found) return found;
	}
	const ring = loadOrMint(masterKeyring);
	cached = cacheRing(masterKeyring, now, ring);
	return ring;
}

/**
 * Whether the instance key is there and opens, for the start gates
 * (floor.ts). It reads the key rows on the owner connection and opens only
 * them: no user key, no actor, no cache, nothing is minted. A missing
 * keystore schema counts as no rows. Every row is opened, so a key that only
 * an older row of a rotation holds is not missed.
 */
export async function checkInstanceKey(
	client: Pick<typeof keystoreDb, "$queryRaw">,
	masterKeyring: Keyring,
): Promise<"ok" | "missing" | "unopenable"> {
	const [present] = await client.$queryRaw<{ table: boolean }[]>`
		SELECT to_regclass('keystore.instance_text_key') IS NOT NULL AS "table"`;
	if (!present?.table) return "missing";
	const rows = await client.$queryRaw<KeyRow[]>`
		SELECT "keyId", "wrappedKey" FROM keystore."instance_text_key"
		ORDER BY "keyId"`;
	if (rows.length === 0) return "missing";
	try {
		unwrapAll(rows, masterKeyring);
	} catch (error) {
		if (error instanceof FieldCryptoError) return "unopenable";
		throw error;
	}
	return "ok";
}

/** Forget the cached keyring: a rotation job, or a test. */
export function evictInstanceKeyring(): void {
	cached = undefined;
}
