import type { Money } from "@retrospend/domain/money-minor";
import type { Change } from "../port";
import type { MemoryStoreOptions } from "../memory-store";
import type { PullApi, PullCursors } from "../sync-pull";

// What the device engine core needs from the platform it runs on, as
// structural types: the network on one side and the disk copy on the other.
// The phone and the web worker each implement them; the engine package knows
// neither the generated client nor a database.

/** The figures the server holds, as `GET /figures` returns them. */
export interface ServerFigures {
	readonly figures: readonly {
		readonly id: string;
		/** One line per currency, or null when the server has no figure (a missing rate). */
		readonly lines: readonly Money[] | null;
	}[];
}

/** The calls the core makes: the sync pulls, and the server's figures to check the device's against. */
export interface DeviceApi extends PullApi {
	figures: {
		read(query: { ids: string }): Promise<ServerFigures>;
	};
}

/** The rows a disk copy held when it was opened, for `MemoryStore`. */
export type LoadedRows = NonNullable<MemoryStoreOptions["rows"]>;

/** What a disk copy held when it was opened. */
export interface LoadedEngine {
	rows: LoadedRows;
	cursors: PullCursors;
	/** A pull ran to its end after the last row was written: the rows are a whole copy. */
	complete: boolean;
}

/** The writer for the engine's store; every call may throw when the disk refuses. */
export interface EnginePersistence {
	/** For `MemoryStoreOptions.onCommit`: throws when the write fails, so the commit fails. */
	commit(changes: readonly Change[]): void;
	/** A pull starts: its first commit clears the pull-complete flag. */
	beginPull(): void;
	/** The pull ran to its end: saves the cursors and sets the flag, in one transaction. */
	finishPull(): void;
	/** The pull failed: the flag stays as the commits left it. */
	abandonPull(): void;
	/** Closes the connection. A live copy then refuses commits (they throw); a given-up one keeps ignoring them. */
	close(): void;
}

export interface StorageHooks {
	/** The cursor object the pull driver keeps; a getter, because a sync reset replaces it. */
	cursors: () => PullCursors;
	/** The disk copy was given up for this session; the engine disposes it and goes on in memory. */
	onDegraded: (cause: string) => void;
}

/** One account's disk copy as the core sees it. */
export interface EngineStorage {
	readonly loaded: LoadedEngine;
	readonly persistence: EnginePersistence;
	/** Closes the connection; with `wipe`, also deletes the file, the key and the index entry. */
	dispose(options: { wipe: boolean }): Promise<void>;
}
