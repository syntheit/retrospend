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
import { userTransaction } from "~/server/db-tx";
import type { Prisma } from "~prisma";
import {
	type FieldAad,
	Keyring,
	openField,
	sealField,
} from "../../crypto/field-crypto";
import { getMasterKeyring } from "../../crypto/master-key";
import {
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
	const { guestSessionId } = actor;
	if (!guestSessionId) throw new InstanceKeyError("no_actor");
	return keystoreDb.$transaction(async (tx) => {
		await tx.$executeRaw`SELECT set_config('app.guest_session_id', ${guestSessionId}, true),
		                            set_config('role', 'retrospend_app', true)`;
		return work(tx);
	});
}

async function loadOrMint(
	actor: InstanceKeyActor,
	masterKeyring: Keyring,
): Promise<Keyring> {
	const rows = await keystore(() =>
		asActor(actor, async (tx) => {
			const found = await tx.$queryRaw<KeyRow[]>`
				SELECT "key_id" AS "keyId", "wrapped_key" AS "wrappedKey"
				FROM keystore."instance_text_keys"()`;
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

type Cached = {
	master: Keyring;
	at: number;
	/** Who started the load; another caller may be sharing it. */
	actor: string;
	ring: Promise<Keyring>;
};
let cached: Cached | undefined;

const actorKey = (actor: InstanceKeyActor): string =>
	actor.kind === "user"
		? `user:${actor.userId}`
		: `guest:${actor.guestSessionId}`;

/**
 * The instance keyring (current key first), made on first use. A failure is
 * never cached. Safe to call from many requests at once: they share one load.
 * A caller that shares a load another actor started, and sees it refused for
 * that actor, tries once more with its own actor, so one invalid caller cannot
 * fail a valid one. `now` is for tests.
 */
export function getOrCreateInstanceKeyring(
	actor: InstanceKeyActor,
	masterKeyring: Keyring | undefined = getMasterKeyring(),
	now: number = Date.now(),
): Promise<Keyring> {
	if (!masterKeyring)
		return Promise.reject(new InstanceKeyError("master_key_missing"));
	const who = actorKey(actor);
	if (
		cached &&
		cached.master === masterKeyring &&
		now - cached.at < CACHE_TTL_MS
	) {
		const shared = cached;
		if (shared.actor === who) return shared.ring;
		return shared.ring.catch((error: unknown) => {
			if (error instanceof InstanceKeyError && error.code === "no_actor")
				return getOrCreateInstanceKeyring(actor, masterKeyring, now);
			throw error;
		});
	}
	const entry: Cached = {
		master: masterKeyring,
		at: now,
		actor: who,
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
