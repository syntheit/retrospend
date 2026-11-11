/**
 * The instance key for shared text (docs/roadmap/e2ee-d11-design.md section 3,
 * lane D11). One random 256-bit key seals text that more than one account
 * reads (shared expenses, people, projects, budget books). It lives in
 * `keystore."instance_text_key"`, wrapped by the server master key, and is read
 * through SECURITY DEFINER functions that require an actor: a signed-in user
 * (`app.current_user_id`), a live guest session (`app.guest_session_id`), or
 * the service (`app.instance_service`, on the owner connection only).
 * Nothing seals with it yet.
 *
 * It always runs on the raw base through `keystoreDb`, in a transaction of its
 * own, never inside a caller's transaction: a keystore call there would join
 * the caller's RLS batch or preview, and a preview must never mint. A user or
 * guest transaction sets the actor and the app role itself, so the database
 * checks the grants and the actor the same way it does for a scoped client.
 *
 * The clients (db.ts) load it with `findInstanceKeyring`, read-only and as the
 * service: the global client serves public pages, guests, viewer links,
 * better-auth and the workers, none of which has a per-request actor.
 *
 * The keyring is cached per process in one entry (key-cache.ts) that the read
 * and the mint share, whatever the actor. A cache hit does not check the actor
 * again: the check guards the database door, and the caller is trusted
 * in-process, where the master key is anyway.
 *
 * Unwrapped keys only live inside a `Keyring`. This file logs nothing and no
 * error names a key or an actor.
 */
import { randomBytes } from "node:crypto";
import { keystoreDb } from "~/server/db-core";
import { userTransaction } from "~/server/db-tx";
import type { Prisma } from "~prisma";
import {
	type FieldAad,
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

export class InstanceKeyError extends KeystoreError {
	declare readonly code: InstanceKeyErrorCode;
	constructor(code: InstanceKeyErrorCode) {
		super(code, MESSAGES[code]);
		this.name = "InstanceKeyError";
	}
}

/**
 * Who asks. The database checks it; nothing here trusts the id. The service
 * actor is accepted only on the owner connection (no role set), so a scoped
 * query or a userTransaction cannot use it by mistake.
 */
export type InstanceKeyActor =
	| { kind: "user"; userId: string }
	| { kind: "guest"; guestSessionId: string }
	| { kind: "service" };

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
 * Runs `work` in one keystore transaction as the actor, dropped to the app
 * role as the scoped client does. A user goes through `userTransaction`, the
 * one place that sets the RLS identity.
 */
async function asActor<T>(
	actor: InstanceKeyActor,
	work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	if (actor.kind === "user") {
		if (!actor.userId) throw new InstanceKeyError("no_actor");
		return userTransaction(keystoreDb, actor.userId, work);
	}
	if (actor.kind === "service")
		return keystoreDb.$transaction(async (tx) => {
			await tx.$executeRaw`SELECT set_config('app.instance_service', 'on', true)`;
			return work(tx);
		});
	const { guestSessionId } = actor;
	if (!guestSessionId) throw new InstanceKeyError("no_actor");
	return keystoreDb.$transaction(async (tx) => {
		await tx.$executeRaw`SELECT set_config('app.guest_session_id', ${guestSessionId}, true),
		                            set_config('role', 'retrospend_app', true)`;
		return work(tx);
	});
}

/** Newest first, so the first row is the current key. */
const readRows = (tx: Prisma.TransactionClient) =>
	tx.$queryRaw<KeyRow[]>`
		SELECT "key_id" AS "keyId", "wrapped_key" AS "wrappedKey"
		FROM keystore."instance_text_keys"()`;

async function find(masterKeyring: Keyring): Promise<Keyring | undefined> {
	const rows = await keystore(() => asActor({ kind: "service" }, readRows));
	return rows.length > 0 ? unwrapAll(rows, masterKeyring) : undefined;
}

async function loadOrMint(
	actor: InstanceKeyActor,
	masterKeyring: Keyring,
): Promise<Keyring> {
	const rows = await keystore(() =>
		asActor(actor, async (tx) => {
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

/** The one process cache: the read, the mint and every actor share it. */
let cached: CachedRing | undefined;

/**
 * The instance keyring, or undefined when none was made yet; never mints. It
 * asks as the service actor, so any caller gets the same answer, and
 * concurrent callers share one load. `now` is for tests.
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
 * "no key", or a cached failure (perhaps another actor's refusal), is not
 * trusted: this actor loads or mints for itself, so one invalid caller cannot
 * fail a valid one. `now` is for tests.
 */
export async function getOrCreateInstanceKeyring(
	actor: InstanceKeyActor,
	masterKeyring: Keyring | undefined = getMasterKeyring(),
	now: number = Date.now(),
): Promise<Keyring> {
	if (!masterKeyring) throw new InstanceKeyError("master_key_missing");
	if (isFresh(cached, masterKeyring, now)) {
		const found = await cached.ring.catch(() => undefined);
		if (found) return found;
	}
	const ring = loadOrMint(actor, masterKeyring);
	cached = cacheRing(masterKeyring, now, ring);
	return ring;
}

/** Forget the cached keyring: a rotation job, or a test. */
export function evictInstanceKeyring(): void {
	cached = undefined;
}
