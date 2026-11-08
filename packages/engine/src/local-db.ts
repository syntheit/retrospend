/**
 * The one door for device writes. Every local write goes through `write`,
 * which runs it in a store transaction, records the rows it changed and hands
 * back an undo token; `preview` runs the same function and rolls back; `undo`
 * applies a token. Repositories never commit on their own.
 *
 * A write function takes the repositories and returns its value. It must do
 * all its work through them (or the writer behind them), and it runs the same
 * way for a preview and for the real write, so the preview is the write.
 */
import { type RowChange, record } from "./changes";
import type { Store } from "./port";
import { type ReadRepos, type Repos, readRepos, repos } from "./repos";
import { applyUndo, tokenFor, type UndoToken } from "./undo";

export type WriteFn<V> = (repos: Repos) => V | Promise<V>;

export interface LocalWrite<V> {
	readonly value: V;
	/** Puts the rows back as they were; see undo.ts for the conflict rule. */
	readonly undo: UndoToken;
}

export interface LocalPreview<V> {
	readonly value: V;
	/** Every row the write would create, edit or delete, with its state before and after. */
	readonly changes: readonly RowChange[];
}

export class LocalDb {
	constructor(private readonly store: Store) {}

	/** Read-only repositories over the store as it is now. */
	reads(): ReadRepos {
		return readRepos(this.store.snapshot());
	}

	/** Runs `run` in a transaction and commits it; throws roll everything back. */
	write<V>(mutation: string, run: WriteFn<V>): Promise<LocalWrite<V>> {
		return this.store.transaction(async (tx) => {
			const recorder = record(tx);
			const value = await run(repos(recorder.writer));
			return { value, undo: tokenFor(mutation, recorder.changes()) };
		});
	}

	/** Runs `run` and rolls it back. The store is exactly as it was. */
	async preview<V>(run: WriteFn<V>): Promise<LocalPreview<V>> {
		const tx = await this.store.begin();
		try {
			const recorder = record(tx);
			const value = await run(repos(recorder.writer));
			return { value, changes: recorder.changes() };
		} finally {
			tx.rollback();
		}
	}

	/**
	 * Undoes a write, atomically. Throws ConflictError when its rows changed
	 * since (nothing is written). Returns the token that undoes the undo.
	 */
	undo(token: UndoToken): Promise<UndoToken> {
		return this.store.transaction((tx) => applyUndo(tx, token));
	}

	/** What an undo would change, for the Undo sheet; applies nothing. */
	async previewUndo(token: UndoToken): Promise<readonly RowChange[]> {
		const tx = await this.store.begin();
		try {
			const recorder = record(tx);
			applyUndo(recorder.writer, token);
			return recorder.changes();
		} finally {
			tx.rollback();
		}
	}
}
