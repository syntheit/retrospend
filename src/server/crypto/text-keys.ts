/**
 * The rings a client opens text with (E2EE D11, docs/roadmap/e2ee-d11-pr3.md
 * section 1.3). The loaders are injected (db.ts wires the key services), so
 * this file never touches the database.
 *
 * `ready()` never throws: a missing master key, a missing keystore or a lost
 * grant is recorded as the class's outcome, so a plaintext ledger keeps
 * working, and only a sealed cell (field-open.ts) looks at it. Each call asks
 * the loaders again; they cache in-process, so a warm call costs no query,
 * and an eviction (a crypto-shred) reaches every client at its next `ready()`.
 *
 * `reload` goes past the loader's cache, for a sealed cell whose key the
 * recorded ring lacks (a key made or added elsewhere since). A crafted cell
 * must not be able to hammer the keystore, so a process reloads one ring at
 * most once per 5 seconds, whatever key id the cell names: callers in that
 * window share the one reload's outcome.
 */
import { KeystoreError, pgCode } from "../services/keys/keystore-errors";
import { FieldCryptoError, type Keyring } from "./field-crypto";
import type { KeyClass } from "./fields";

export type KeyOutcome =
	| { ring: Keyring }
	/** No key row; with `code: "master_key_missing"`, no master key is set (and no query ran). */
	| { none: true; code?: string }
	/** The keystore could not be read; the code says why. */
	| { failed: string };

/**
 * Resolves to undefined when no key was ever made; never mints. `fresh` skips
 * the loader's cache (and replaces its entry).
 */
export type KeyLoader = (fresh: boolean) => Promise<Keyring | undefined>;

export interface TextKeys {
	/** Whose user-class cells these keys open; undefined on the global client, which opens none. */
	readonly userId: string | undefined;
	/** Loads every class and records its outcome. Never throws. */
	ready(): Promise<void>;
	/** The ring `ready()` recorded for the class, if it found one. */
	ring(cls: KeyClass): Keyring | undefined;
	/** What `ready()` recorded for the class; undefined before the first call. */
	outcome(cls: KeyClass): KeyOutcome | undefined;
	/** Loads the class past the caches and records it; throttled per process (see above). */
	reload(cls: KeyClass): Promise<Keyring | undefined>;
	/**
	 * Starts `reload` without waiting for it, for a caller that cannot wait (a
	 * transaction). False when a reload already settled on the very ring this
	 * client holds, so the key is not coming and a retry cannot help; that
	 * answer holds until the key cache changes (a new ring is loaded, after an
	 * eviction, a mint or the cache's own expiry).
	 */
	reloadInBackground(cls: KeyClass): boolean;
	/**
	 * Makes the class's key if there is none yet, records the outcome and
	 * returns the ring; never throws. For the first write that seals, and only
	 * outside a transaction: the mint takes a connection of its own.
	 */
	ensure(cls: KeyClass): Promise<Keyring | undefined>;
}

/** Makes the class's key if none exists (on its own connection) and returns the ring. */
export type KeyMinter = () => Promise<Keyring>;

const CLASSES: readonly KeyClass[] = ["user", "instance"];

export const RELOAD_INTERVAL_MS = 5000;

type Reload = { at: number; outcome: Promise<KeyOutcome>; settled: boolean };

/** The last reload of each ring (the instance ring, or one user's), shared by every client. */
const reloads = new Map<string, Reload>();

/**
 * The ring the last settled reload of each ring id found (undefined for no
 * key). A client whose recorded ring is this same object has nothing newer
 * than that reload. Bounded like the user ring cache.
 */
const settledRings = new Map<string, { ring: Keyring | undefined }>();
const SETTLED_LIMIT = 1000;

const recentReload = (ringId: string): Reload | undefined => {
	const last = reloads.get(ringId);
	return last && Date.now() - last.at < RELOAD_INTERVAL_MS ? last : undefined;
};

function throttledReload(
	ringId: string,
	run: () => Promise<KeyOutcome>,
): Reload {
	const recent = recentReload(ringId);
	if (recent) return recent;
	const now = Date.now();
	for (const [id, { at }] of reloads)
		if (now - at >= RELOAD_INTERVAL_MS) reloads.delete(id);
	const entry: Reload = { at: now, outcome: run(), settled: false };
	entry.outcome.then((outcome) => {
		entry.settled = true;
		settledRings.delete(ringId);
		settledRings.set(ringId, { ring: ringOf(outcome) });
		const oldest = settledRings.keys().next().value;
		if (settledRings.size > SETTLED_LIMIT && oldest !== undefined)
			settledRings.delete(oldest);
	});
	reloads.set(ringId, entry);
	return entry;
}

/** Test hook: forget the reload throttle. */
export function resetReloadsForTests(): void {
	reloads.clear();
	settledRings.clear();
}

/** Errors already logged: a failed load stays cached for 30 seconds, and every `ready()` meanwhile sees the same error. */
const logged = new WeakSet<object>();

/**
 * Logs an error that has no stable code, once. Only the key class, the error's
 * name and its SQLSTATE: a message can carry a user id or query text.
 */
function logUnexpected(cls: KeyClass, error: unknown): void {
	if (typeof error === "object" && error !== null) {
		if (logged.has(error)) return;
		logged.add(error);
	}
	console.error("Key load failed", {
		keyClass: cls,
		error: error instanceof Error ? error.name : typeof error,
		sqlstate: pgCode(error) ?? null,
	});
}

async function settle(
	cls: KeyClass,
	load: KeyLoader,
	fresh: boolean,
): Promise<KeyOutcome> {
	try {
		const ring = await load(fresh);
		return ring ? { ring } : { none: true };
	} catch (error) {
		// Our own errors carry a stable code; anything else (the database is
		// down) gets one generic code, and is logged without its text.
		if (
			!(error instanceof KeystoreError || error instanceof FieldCryptoError)
		) {
			logUnexpected(cls, error);
			return { failed: "keystore_unavailable" };
		}
		const { code } = error;
		return code === "master_key_missing"
			? { none: true, code }
			: { failed: code };
	}
}

const ringOf = (outcome: KeyOutcome | undefined) =>
	outcome && "ring" in outcome ? outcome.ring : undefined;

/**
 * Keys for `userId`'s clients, or for the global client with no `userId`. A
 * class with no loader (the user class on the global client) has no key, and
 * one with no minter is never made here.
 */
export function textKeys(
	loaders: Partial<Record<KeyClass, KeyLoader>>,
	userId?: string,
	minters: Partial<Record<KeyClass, KeyMinter>> = {},
): TextKeys {
	const outcomes = new Map<KeyClass, KeyOutcome>();
	// The instance ring is one per process; a user ring is that user's.
	const ringIdOf = (cls: KeyClass) =>
		cls === "instance" ? "instance" : `user:${userId}`;
	return {
		userId,
		async ready() {
			await Promise.all(
				CLASSES.map(async (cls) => {
					const load = loaders[cls];
					outcomes.set(
						cls,
						load ? await settle(cls, load, false) : { none: true },
					);
				}),
			);
		},
		ring: (cls) => ringOf(outcomes.get(cls)),
		outcome: (cls) => outcomes.get(cls),
		async reload(cls) {
			const load = loaders[cls];
			if (!load) return undefined;
			const outcome = await throttledReload(ringIdOf(cls), () =>
				settle(cls, load, true),
			).outcome;
			outcomes.set(cls, outcome);
			return ringOf(outcome);
		},
		reloadInBackground(cls) {
			const load = loaders[cls];
			if (!load) return false;
			const ringId = ringIdOf(cls);
			const settled = settledRings.get(ringId);
			if (settled && settled.ring === ringOf(outcomes.get(cls))) return false;
			// settle() never rejects, so nothing is left unhandled.
			return !throttledReload(ringId, () => settle(cls, load, true)).settled;
		},
		async ensure(cls) {
			const mint = minters[cls];
			if (!mint) return undefined;
			const outcome = await settle(cls, mint, false);
			outcomes.set(cls, outcome);
			return ringOf(outcome);
		},
	};
}
