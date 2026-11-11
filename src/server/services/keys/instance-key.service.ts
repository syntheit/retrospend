/**
 * The instance key for shared text (docs/roadmap/e2ee-d11-design.md section 3,
 * lane D11). One random 256-bit key seals text that more than one account
 * reads (shared expenses, people, projects, budget books). It lives in
 * `keystore."instance_text_key"`, wrapped by the server master key, and is read
 * through SECURITY DEFINER functions that require an actor: a signed-in user
 * (`app.current_user_id`) or a live guest session (`app.guest_session_id`).
 * Nothing seals with it yet, and no Prisma extension calls this yet.
 *
 * It always runs on the raw base through `keystoreDb`, in a transaction of its
 * own, never inside a caller's transaction: a keystore call there would join
 * the caller's RLS batch or preview, and a preview must never mint. The
 * transaction sets the actor and the app role itself, so the database checks
 * the grants and the actor the same way it does for a scoped client.
 *
 * The keyring is cached per process, with a short TTL so a rotation (a key
 * added by D12) reaches every process. The cache is keyed to the master keyring
 * it was unwrapped with. A cache hit does not check the actor again: the check
 * guards the database door, and the caller (a signed-in procedure, or a guest
 * procedure that has already verified the session token) is trusted in-process,
 * where the master key is anyway.
 *
 * Unwrapped keys only live inside a `Keyring`. This file logs nothing and no
 * error names a key or an actor.
 */
import { randomBytes } from "node:crypto";
import { keystoreDb } from "~/server/db";
import { Prisma } from "~prisma";
import {
	type FieldAad,
	Keyring,
	openField,
	sealField,
} from "../../crypto/field-crypto";
import { getMasterKeyring } from "../../crypto/master-key";

export type InstanceKeyErrorCode =
	/** DATA_MASTER_KEY is not configured, so the key cannot be sealed or opened. */
	| "master_key_missing"
	/** The keystore table or functions are gone; see "Data key backups" in docs/self-hosting.md. */
	| "keystore_missing"
	/** The caller named no actor, or one the database does not know (a user, or a live guest session). */
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
	no_actor: "There is no signed-in user or guest session for the key store",
	keystore_grants_missing:
		"The app cannot reach the key store. Re-apply the grants in Data key backups in docs/self-hosting.md",
	keystore_lost:
		"The instance key was made before and is gone from the key store. See Data key backups in docs/self-hosting.md",
};

export class InstanceKeyError extends Error {
	readonly code: InstanceKeyErrorCode;
	constructor(code: InstanceKeyErrorCode) {
		super(MESSAGES[code]);
		this.name = "InstanceKeyError";
		this.code = code;
	}
}

/** Who asks. The database checks it; nothing here trusts the id. */
export type InstanceKeyActor =
	| { kind: "user"; userId: string }
	| { kind: "guest"; guestSessionId: string };

const FIRST_KEY_ID = 1;
const INSTANCE_KEY_BYTES = 32;
/** Matches the design's cache window for user keys (section 2.1). */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Binds a wrapped key to its version: a copy under another id fails to open. */
function wrapAad(keyId: number): FieldAad {
	return {
		table: "keystore.instance_text_key",
		column: "wrappedKey",
		rowId: String(keyId),
	};
}

type KeyRow = { keyId: number; wrappedKey: string };

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
 * stable errors: 42P01, 3F000 or 42883 mean the keystore is missing; 28000 is
 * the functions refusing a missing or unknown actor; 42501 is a missing grant;
 * KS001 is the mint function refusing to replace a key that was lost.
 */
async function keystore<T>(query: () => Promise<T>): Promise<T> {
	try {
		return await query();
	} catch (error) {
		const code = pgCode(error);
		if (code === "42P01" || code === "3F000" || code === "42883")
			throw new InstanceKeyError("keystore_missing");
		if (code === "28000") throw new InstanceKeyError("no_actor");
		if (code === "42501") throw new InstanceKeyError("keystore_grants_missing");
		if (code === "KS001") throw new InstanceKeyError("keystore_lost");
		throw error;
	}
}

function unwrapAll(rows: KeyRow[], masterKeyring: Keyring): Keyring {
	return new Keyring(
		rows.map(({ keyId, wrappedKey }) => ({
			id: keyId,
			key: Buffer.from(
				openField(masterKeyring, wrappedKey, wrapAad(keyId)),
				"base64",
			),
		})),
	);
}

/** Sets the actor and drops to the app role for this transaction, as the scoped client does. */
async function enterActor(
	tx: Prisma.TransactionClient,
	actor: InstanceKeyActor,
): Promise<void> {
	if (actor.kind === "user") {
		if (!actor.userId) throw new InstanceKeyError("no_actor");
		await tx.$executeRaw`SELECT set_config('app.current_user_id', ${actor.userId}, true),
		                            set_config('role', 'retrospend_app', true)`;
		return;
	}
	if (!actor.guestSessionId) throw new InstanceKeyError("no_actor");
	await tx.$executeRaw`SELECT set_config('app.guest_session_id', ${actor.guestSessionId}, true),
	                            set_config('role', 'retrospend_app', true)`;
}

async function loadOrMint(
	actor: InstanceKeyActor,
	masterKeyring: Keyring,
): Promise<Keyring> {
	const rows = await keystore(() =>
		keystoreDb.$transaction(async (tx) => {
			await enterActor(tx, actor);
			const found = await tx.$queryRaw<KeyRow[]>`
				SELECT "key_id" AS "keyId", "wrapped_key" AS "wrappedKey"
				FROM keystore."instance_text_keys"()`;
			if (found.length > 0) return found;
			const wrapped = sealField(
				masterKeyring,
				randomBytes(INSTANCE_KEY_BYTES).toString("base64"),
				wrapAad(FIRST_KEY_ID),
			);
			// Two processes that mint together end up with one key: the function
			// serializes them and keeps the first row, and both read it back.
			return tx.$queryRaw<KeyRow[]>`
				SELECT "key_id" AS "keyId", "wrapped_key" AS "wrappedKey"
				FROM keystore."create_first_instance_key"(${wrapped}, ${masterKeyring.currentId}::bigint)`;
		}),
	);
	return unwrapAll(rows, masterKeyring);
}

type Cached = { master: Keyring; at: number; ring: Promise<Keyring> };
let cached: Cached | undefined;

/**
 * The instance keyring (current key first), made on first use. A failure is
 * never cached. Safe to call from many requests at once: they share one load.
 * `now` is for tests.
 */
export function getOrCreateInstanceKeyring(
	actor: InstanceKeyActor,
	masterKeyring: Keyring | undefined = getMasterKeyring(),
	now: number = Date.now(),
): Promise<Keyring> {
	if (!masterKeyring)
		return Promise.reject(new InstanceKeyError("master_key_missing"));
	if (
		cached &&
		cached.master === masterKeyring &&
		now - cached.at < CACHE_TTL_MS
	)
		return cached.ring;
	const entry: Cached = {
		master: masterKeyring,
		at: now,
		ring: loadOrMint(actor, masterKeyring),
	};
	cached = entry;
	entry.ring.catch(() => {
		if (cached === entry) cached = undefined;
	});
	return entry.ring;
}

/** Forget the cached keyring: a rotation job, or a test. */
export function evictInstanceKeyring(): void {
	cached = undefined;
}
