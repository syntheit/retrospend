/**
 * The rings a client opens text with (E2EE D11, docs/roadmap/e2ee-d11-pr3.md
 * section 1.3). The loaders are injected (db.ts wires the key services), so
 * this file never touches the database.
 *
 * `ready()` never throws: a missing master key, a missing keystore or a lost
 * grant is recorded as the class's outcome, so a plaintext ledger keeps
 * working, and only a sealed cell (lane D11 PR 3.2) looks at it. Each call
 * asks the loaders again; they cache in-process, so a warm call costs no
 * query, and an eviction (a crypto-shred) reaches every client at its next
 * `ready()`.
 */
import { KeystoreError } from "../services/keys/keystore-errors";
import { FieldCryptoError, type Keyring } from "./field-crypto";
import type { KeyClass } from "./fields";

export type KeyOutcome =
	| { ring: Keyring }
	/** No key row; with `code: "master_key_missing"`, no master key is set (and no query ran). */
	| { none: true; code?: string }
	/** The keystore could not be read; the code says why. */
	| { failed: string };

/** Resolves to undefined when no key was ever made; never mints. */
export type KeyLoader = () => Promise<Keyring | undefined>;

export interface TextKeys {
	/** Loads every class and records its outcome. Never throws. */
	ready(): Promise<void>;
	/** The ring `ready()` recorded for the class, if it found one. */
	ring(cls: KeyClass): Keyring | undefined;
	/** What `ready()` recorded for the class; undefined before the first call. */
	outcome(cls: KeyClass): KeyOutcome | undefined;
}

const CLASSES: readonly KeyClass[] = ["user", "instance"];

async function settle(load: KeyLoader): Promise<KeyOutcome> {
	try {
		const ring = await load();
		return ring ? { ring } : { none: true };
	} catch (error) {
		// Our own errors carry a stable code; anything else (the database is
		// down) gets one generic code, and its text is never kept.
		const code =
			error instanceof KeystoreError || error instanceof FieldCryptoError
				? error.code
				: "keystore_unavailable";
		return code === "master_key_missing"
			? { none: true, code }
			: { failed: code };
	}
}

/** A class with no loader (the user class on the global client) has no key. */
export function textKeys(
	loaders: Partial<Record<KeyClass, KeyLoader>>,
): TextKeys {
	const outcomes = new Map<KeyClass, KeyOutcome>();
	return {
		async ready() {
			await Promise.all(
				CLASSES.map(async (cls) => {
					const load = loaders[cls];
					outcomes.set(cls, load ? await settle(load) : { none: true });
				}),
			);
		},
		ring(cls) {
			const outcome = outcomes.get(cls);
			return outcome && "ring" in outcome ? outcome.ring : undefined;
		},
		outcome: (cls) => outcomes.get(cls),
	};
}
