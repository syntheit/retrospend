import {
	type Change,
	type MemoryStoreOptions,
	type PullCursors,
	SINGLE_ROW_IDS,
	TABLE_NAMES,
	type TableName,
} from "@retrospend/engine";
import { type FailureKind, failureKind, type SqlDriver } from "./driver";
import { decodeRow, encodeRow, SerializeError } from "./serialize";

// The device engine's rows on disk: one `rows` table of JSON by table and id,
// and a `meta` table with the schema version, the owner, the pull cursors and
// the pull-complete flag. The disk copy is a cache of the server: anything
// that does not read back exactly is dropped and pulled again, never repaired.
//
// The cursors saved with each commit are read from the live cursor object,
// which the pull driver moves only after a page's transaction has committed,
// so a saved cursor is always at or behind the rows saved with it. A pull
// that stops half way therefore resumes without a gap, and it clears the
// pull-complete flag with its first commit so a cold start never reads
// figures from rows that a pull was still filling.

export const SCHEMA_VERSION = "1";

/** Failed writes in one session after which the disk copy is given up. */
export const WRITE_FAILURE_LIMIT = 3;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rows (
	tbl TEXT NOT NULL,
	id TEXT NOT NULL,
	json TEXT NOT NULL,
	PRIMARY KEY (tbl, id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
) WITHOUT ROWID;`;

const UPSERT_ROW =
	"INSERT INTO rows (tbl, id, json) VALUES (?, ?, ?) ON CONFLICT (tbl, id) DO UPDATE SET json = excluded.json";
const DELETE_ROW = "DELETE FROM rows WHERE tbl = ? AND id = ?";
const UPSERT_META =
	"INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value";
const DELETE_META = "DELETE FROM meta WHERE key = ?";

const TABLES: ReadonlySet<string> = new Set(TABLE_NAMES);

export type LoadedRows = NonNullable<MemoryStoreOptions["rows"]>;

/** What a database held when it was opened. */
export interface LoadedEngine {
	rows: LoadedRows;
	cursors: PullCursors;
	/** A pull ran to its end after the last row was written: the rows are a whole copy. */
	complete: boolean;
	/** The file held something unreadable or from another schema or owner, and was emptied. */
	wiped: boolean;
	rowCount: number;
}

/** The file holds something a load cannot trust. */
class Untrusted extends Error {
	override readonly name = "Untrusted";
}

/** Throws Untrusted for anything a load cannot trust. */
function readAll(driver: SqlDriver, owner: string): LoadedEngine {
	const meta = new Map(
		driver
			.all<{ key: string; value: string }>("SELECT key, value FROM meta")
			.map((r) => [r.key, r.value]),
	);
	if (meta.get("schemaVersion") !== SCHEMA_VERSION)
		throw new Untrusted("schema");
	if (meta.get("origin") !== owner) throw new Untrusted("owner");

	let cursors: PullCursors = {};
	const savedCursors = meta.get("cursors");
	if (savedCursors !== undefined) {
		const parsed: unknown = JSON.parse(savedCursors);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed) ||
			!Object.values(parsed).every((v) => typeof v === "string")
		)
			throw new Untrusted("cursors");
		cursors = parsed as PullCursors;
	}

	const rows: Record<string, unknown[]> = {};
	let rowCount = 0;
	for (const r of driver.all<{ tbl: string; id: string; json: string }>(
		"SELECT tbl, id, json FROM rows",
	)) {
		const row = TABLES.has(r.tbl) ? decodeRow(r.json) : undefined;
		const only = SINGLE_ROW_IDS[r.tbl as TableName];
		if (
			typeof row !== "object" ||
			row === null ||
			(row as { id?: unknown }).id !== r.id ||
			(only !== undefined && r.id !== only)
		)
			throw new Untrusted("row");
		const bucket = rows[r.tbl] ?? [];
		bucket.push(row);
		rows[r.tbl] = bucket;
		rowCount += 1;
	}
	return {
		rows: rows as LoadedRows,
		cursors,
		complete: meta.get("pullComplete") === "1",
		wiped: false,
		rowCount,
	};
}

function reset(driver: SqlDriver, owner: string) {
	driver.transaction(() => {
		driver.exec("DELETE FROM rows; DELETE FROM meta;");
		driver.runMany(UPSERT_META, [
			["schemaVersion", SCHEMA_VERSION],
			["origin", owner],
		]);
	});
}

/**
 * Creates the schema if the file is new and reads everything back. A file
 * that fails any check is emptied and loaded as empty: `wiped` says so.
 * Throws only when the SQL itself fails (a bad key, a broken file), which the
 * caller treats as a file to delete.
 */
export function loadEngineDb(driver: SqlDriver, owner: string): LoadedEngine {
	driver.exec(SCHEMA);
	const fresh =
		driver.all<{ n: number }>("SELECT count(*) AS n FROM meta")[0]?.n === 0;
	if (fresh) {
		reset(driver, owner);
		return {
			rows: {},
			cursors: {},
			complete: false,
			wiped: false,
			rowCount: 0,
		};
	}
	try {
		return readAll(driver, owner);
	} catch (error) {
		// A SQL failure is not the data being wrong: let it reach the caller.
		if (failureKind(error) !== "other") throw error;
		if (!(error instanceof Untrusted) && !isParseFailure(error)) throw error;
		reset(driver, owner);
		return { rows: {}, cursors: {}, complete: false, wiped: true, rowCount: 0 };
	}
}

/** What JSON.parse and the row decoder throw for text this module did not write. */
const isParseFailure = (e: unknown) =>
	e instanceof SyntaxError || e instanceof SerializeError;

export type PersistenceState = "live" | "degraded" | "closed";

export interface PersistenceOptions {
	/** The cursor object the pull driver keeps; a getter, because a sync reset replaces it. */
	cursors: () => PullCursors;
	/**
	 * The disk copy is given up for this session (the disk is full or corrupt,
	 * or writes failed too often). The owner closes and deletes the file.
	 * Commits from then on succeed in memory only.
	 */
	onDegraded: (cause: FailureKind | "repeated") => void;
}

export interface Persistence {
	readonly state: PersistenceState;
	/** For `MemoryStoreOptions.onCommit`: throws when the write fails, so the commit fails. */
	commit(changes: readonly Change[]): void;
	/** A pull starts: its first commit clears the pull-complete flag. */
	beginPull(): void;
	/** The pull ran to its end: saves the cursors and sets the flag, in one transaction. */
	finishPull(): void;
	/** The pull failed: the flag stays as the commits left it. */
	abandonPull(): void;
	/** Stops accepting commits (they throw) and closes the connection. */
	close(): void;
}

export function createPersistence(
	driver: SqlDriver,
	loaded: Pick<LoadedEngine, "complete">,
	options: PersistenceOptions,
): Persistence {
	let state: PersistenceState = "live";
	let complete = loaded.complete;
	let pulling = false;
	let failures = 0;

	function fail(error: unknown): void {
		failures += 1;
		const kind = failureKind(error);
		const fatal = kind === "full" || kind === "corrupt";
		if (!fatal && failures < WRITE_FAILURE_LIMIT) throw error;
		state = "degraded";
		options.onDegraded(fatal ? kind : "repeated");
	}

	function write(work: () => void): void {
		if (state === "closed") throw new Error("The engine database is closed");
		if (state === "degraded") return;
		try {
			work();
		} catch (error) {
			fail(error);
		}
	}

	return {
		get state() {
			return state;
		},
		commit(changes) {
			write(() => {
				const upserts: (readonly [string, string, string])[] = [];
				const deletes: (readonly [string, string])[] = [];
				for (const c of changes)
					if (c.row === null) deletes.push([c.table, c.id]);
					else upserts.push([c.table, c.id, encodeRow(c.row)]);
				const cursors = JSON.stringify(options.cursors());
				const clearFlag = pulling && complete;
				driver.transaction(() => {
					if (deletes.length > 0) driver.runMany(DELETE_ROW, deletes);
					if (upserts.length > 0) driver.runMany(UPSERT_ROW, upserts);
					driver.run(UPSERT_META, ["cursors", cursors]);
					if (clearFlag) driver.run(DELETE_META, ["pullComplete"]);
				});
				if (clearFlag) complete = false;
			});
		},
		beginPull() {
			pulling = true;
		},
		finishPull() {
			write(() => {
				const cursors = JSON.stringify(options.cursors());
				driver.transaction(() => {
					driver.run(UPSERT_META, ["cursors", cursors]);
					driver.run(UPSERT_META, ["pullComplete", "1"]);
				});
				complete = true;
				pulling = false;
			});
		},
		abandonPull() {
			pulling = false;
		},
		close() {
			if (state === "closed") return;
			state = "closed";
			try {
				driver.close();
			} catch {
				// The file is deleted next; a connection that will not close changes nothing.
			}
		},
	};
}
