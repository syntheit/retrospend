/**
 * The field encryption epoch (E2EE D11 PR 4.3, docs/roadmap/e2ee-d11-pr4.md
 * section 3): `app_settings."fieldEncryptionSince"`, written once when a
 * server first starts with DATA_KEYS_WRITE on and never cleared. From then on
 * any mapped cell may hold ciphertext, whatever this process's own flag says,
 * so filters on mapped columns are refused (field-open.ts) and searches read
 * in the app (search-fold.ts).
 *
 * One cache per process, shared by every client. A set epoch is kept forever,
 * since it is never cleared; "not set" for 30 seconds, so a replica sees
 * another's first start soon. So every process reads the column at most once
 * per 30 seconds until it is set, whatever its own flag. It loads with the
 * keys (`TextKeys.ready()`), outside transactions; inside one only the cached
 * answer is used, since a query there would take a second pool connection
 * while the transaction holds one. The reader is injected (db.ts), so this
 * file never touches the database.
 *
 * An unknown epoch counts as set (fail closed): a read that failed is never
 * cached as an answer, and until one succeeds, filters on mapped columns are
 * refused and searches read in the app, so none can quietly miss a sealed
 * row. The same holds inside a transaction whose client never loaded it.
 */
import { inTransaction } from "~/server/db-tx";

/** Whether the epoch is set in the database. */
export type EpochReader = () => Promise<boolean>;

export const NOT_SET_TTL_MS = 30_000;

let reader: EpochReader | undefined;
/** The last successful read. */
let known: { set: true } | { set: false; until: number } | undefined;
/** The last read failed; cleared by the next one that succeeds. */
let failed = false;
let loading: Promise<boolean> | undefined;

/** db.ts wires the database read once, at start; a test may unwire it. */
export function setEpochReader(read: EpochReader | undefined): void {
	reader = read;
}

/**
 * The cached answer, without a query: true when the epoch is set or unknown
 * (a read failed, or none ran yet). With no reader wired (a unit test, no
 * database) nothing can be sealed, so it is false.
 */
export const epochActiveNow = (): boolean =>
	known?.set === true ||
	(reader !== undefined && (failed || known === undefined));

/**
 * The answer `epochActiveNow` gives once a stale cache has been read again.
 * Never throws: a failed read is logged and leaves the epoch unknown (true).
 * Inside a transaction, and with no reader wired, it answers from the cache.
 */
export function loadEpoch(): Promise<boolean> {
	const fresh = known && (known.set || Date.now() < known.until);
	if (fresh || !reader || inTransaction())
		return Promise.resolve(epochActiveNow());
	loading ??= reader()
		.then(
			(set) => {
				// A set epoch is never cleared, so a slow "not set" cannot undo one.
				if (known?.set !== true)
					known = set
						? { set: true }
						: { set: false, until: Date.now() + NOT_SET_TTL_MS };
				failed = false;
			},
			(error: unknown) => {
				// The error's kind only: a message can carry query text.
				console.error("Field encryption epoch read failed", {
					error: error instanceof Error ? error.name : typeof error,
				});
				failed = true;
			},
		)
		.then(() => {
			loading = undefined;
			return epochActiveNow();
		});
	return loading;
}

/** The start-up check wrote (or found) the epoch. */
export function markEpochActive(): void {
	known = { set: true };
}

/** Test hook: forget the cache, or set it. */
export function resetEpochForTests(set?: true): void {
	known = set ? { set } : undefined;
	failed = false;
	loading = undefined;
}
