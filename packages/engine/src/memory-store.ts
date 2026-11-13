/**
 * The in-memory store: every table a map of rows by id, with copy-on-write
 * transactions.
 *
 * Copy-on-write: a transaction writes to an overlay (id to row, or null for a
 * delete) over the committed state; rollback drops the overlay and commit
 * builds new maps for the tables it touched, shares the rest, and swaps the
 * state in one assignment. A Snapshot holds the old state object, so it never
 * sees a later commit, and a preview is a transaction that rolls back.
 *
 * Concurrency rule: top-level transactions are serialized in call order (the
 * store queues `begin`), so each reads what the one before it committed and
 * there is nothing to merge. Nesting is a savepoint on the open transaction
 * (see Tx.savepoint).
 *
 * `onCommit` is the persistence hook: it gets the changes before they become
 * visible, and if it throws the commit fails and nothing changed. A SQLCipher
 * layer writes them there in one SQL transaction.
 */
import {
	type Change,
	InvalidInputError,
	type Reader,
	SINGLE_ROW_IDS,
	type Snapshot,
	type Store,
	TABLE_NAMES,
	type TableName,
	type TableRows,
	TransactionError,
	type Tx,
} from "./port";

type AnyRow = TableRows[TableName];
type Rows = ReadonlyMap<string, AnyRow>;
type State = Readonly<Record<TableName, Rows>>;
/** Writes by table and id; null deletes. */
type Overlay = Map<TableName, Map<string, AnyRow | null>>;

const byId = (a: { id: string }, b: { id: string }) =>
	a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const isPlain = (v: object) => {
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
};

/**
 * A deep copy with plain objects and arrays frozen, so callers keep no handle
 * that could change a stored row and a reader cannot edit one. Dates are
 * copied (they cannot be frozen); other class instances, such as Decimal, are
 * immutable values and kept as they are.
 */
function own<V>(v: V): V {
	if (Array.isArray(v)) return Object.freeze(v.map(own)) as V;
	if (v instanceof Date) return new Date(v.getTime()) as V;
	if (v !== null && typeof v === "object" && isPlain(v))
		return Object.freeze(
			Object.fromEntries(Object.entries(v).map(([k, x]) => [k, own(x)])),
		) as V;
	return v;
}

/** The copy a table keeps of a row; refuses what the table cannot hold. */
function owned<T extends TableName>(table: T, row: TableRows[T]): TableRows[T] {
	const only = SINGLE_ROW_IDS[table];
	if (only !== undefined && row.id !== only)
		throw new InvalidInputError(
			`The ${table} table has one row, with id "${only}"`,
		);
	return own(row);
}

/**
 * A row as a reader gets it: its Dates are fresh copies, since a Date cannot
 * be frozen and `setTime` on a shared one would change committed state. A row
 * with no Date is handed out as stored.
 */
function out<V>(v: V): V {
	if (v instanceof Date) return new Date(v.getTime()) as V;
	if (Array.isArray(v)) {
		const copy = v.map(out);
		return copy.some((x, i) => x !== v[i]) ? (Object.freeze(copy) as V) : v;
	}
	if (v !== null && typeof v === "object" && isPlain(v)) {
		const entries = Object.entries(v);
		const copy = entries.map(([k, x]) => [k, out(x)] as const);
		return copy.some(([, x], i) => x !== entries[i]?.[1])
			? (Object.freeze(Object.fromEntries(copy)) as V)
			: v;
	}
	return v;
}

class Snap implements Snapshot {
	/** The stored rows themselves, for a transaction that copies on its own reads. */
	readonly raw: Reader;

	constructor(state: State) {
		this.raw = {
			get: <T extends TableName>(table: T, id: string) =>
				state[table].get(id) as TableRows[T] | undefined,
			list: <T extends TableName>(table: T) =>
				[...state[table].values()].sort(byId) as TableRows[T][],
		};
	}

	get<T extends TableName>(table: T, id: string) {
		return out(this.raw.get(table, id));
	}

	list<T extends TableName>(table: T) {
		return out(this.raw.list(table));
	}
}

interface TxHooks {
	/** Takes the writes; throwing fails the commit. */
	commit(overlay: Overlay): void | Promise<void>;
	/** Runs once when the transaction ends, committed or not. */
	end(): void;
}

class MemoryTx implements Tx {
	private overlay: Overlay = new Map();
	private done = false;
	private childOpen = false;

	/** Reads with no state check: what a savepoint reads through. */
	private readonly view: Reader;

	constructor(
		base: Reader,
		private readonly hooks: TxHooks,
	) {
		this.view = {
			get: <T extends TableName>(table: T, id: string) => {
				const written = this.overlay.get(table)?.get(id);
				return written === undefined
					? base.get(table, id)
					: ((written ?? undefined) as TableRows[T] | undefined);
			},
			list: <T extends TableName>(table: T) => {
				const rows = new Map<string, AnyRow>();
				for (const r of base.list(table)) rows.set(r.id, r);
				for (const [id, r] of this.overlay.get(table) ?? [])
					if (r === null) rows.delete(id);
					else rows.set(id, r);
				return [...rows.values()].sort(byId) as TableRows[T][];
			},
		};
	}

	private live() {
		if (this.done) throw new TransactionError("The transaction has ended");
		if (this.childOpen) throw new TransactionError("A savepoint is open");
	}

	get<T extends TableName>(table: T, id: string) {
		this.live();
		return out(this.view.get(table, id));
	}

	list<T extends TableName>(table: T) {
		this.live();
		return out(this.view.list(table));
	}

	put<T extends TableName>(table: T, row: TableRows[T]) {
		this.live();
		this.write(table, row.id, owned(table, row));
	}

	delete(table: TableName, id: string) {
		this.live();
		const existed = this.view.get(table, id) !== undefined;
		this.write(table, id, null);
		return existed;
	}

	private write(table: TableName, id: string, row: AnyRow | null) {
		const writes = this.overlay.get(table) ?? new Map();
		writes.set(id, row);
		this.overlay.set(table, writes);
	}

	async commit() {
		this.live();
		this.done = true;
		try {
			await this.hooks.commit(this.overlay);
		} finally {
			this.overlay = new Map();
			this.hooks.end();
		}
	}

	rollback() {
		if (this.done) return;
		this.done = true;
		this.overlay = new Map();
		this.hooks.end();
	}

	savepoint(): Tx {
		this.live();
		this.childOpen = true;
		return new MemoryTx(this.view, {
			commit: (writes) => this.absorb(writes),
			end: () => {
				this.childOpen = false;
			},
		});
	}

	/** A committed savepoint's writes become this transaction's. */
	private absorb(writes: Overlay) {
		if (this.done) throw new TransactionError("The transaction has ended");
		for (const [table, rows] of writes)
			for (const [id, row] of rows) this.write(table, id, row);
	}
}

export interface MemoryStoreOptions {
	/** Rows the store starts with. */
	rows?: { [T in TableName]?: readonly TableRows[T][] };
	/** Called with a commit's changes before they become visible. */
	onCommit?: (changes: readonly Change[]) => void | Promise<void>;
	/**
	 * How long `begin` waits for earlier transactions before it throws
	 * TransactionError, in milliseconds. Unset waits forever, which hides a
	 * transaction nobody committed or rolled back.
	 */
	beginTimeoutMs?: number;
}

/** The timer functions every runtime here has; the package declares no DOM or Node types. */
const timers = globalThis as unknown as {
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
};

export class MemoryStore implements Store {
	private state: State;
	/** Settles when the newest transaction has ended. */
	private tail: Promise<void> = Promise.resolve();
	/** True while a `transaction` callback runs its synchronous part. */
	private inCallback = false;
	private readonly onCommit: MemoryStoreOptions["onCommit"];
	private readonly beginTimeoutMs: number | undefined;

	constructor(options: MemoryStoreOptions = {}) {
		this.onCommit = options.onCommit;
		this.beginTimeoutMs = options.beginTimeoutMs;
		const state = {} as Record<TableName, Rows>;
		for (const table of TABLE_NAMES) {
			const rows = new Map<string, AnyRow>();
			for (const row of options.rows?.[table] ?? [])
				rows.set(row.id, owned(table, row));
			state[table] = rows;
		}
		this.state = state;
	}

	snapshot(): Snapshot {
		return new Snap(this.state);
	}

	get<T extends TableName>(table: T, id: string) {
		return this.snapshot().get(table, id);
	}

	list<T extends TableName>(table: T) {
		return this.snapshot().list(table);
	}

	async begin(): Promise<Tx> {
		// Only the synchronous part of a callback can be told apart from another
		// caller; a nested begin after an await waits until the timeout.
		if (this.inCallback)
			throw new TransactionError(
				"begin was called inside a transaction callback, which would wait for itself; use tx.savepoint()",
			);
		const before = this.tail;
		let release!: () => void;
		this.tail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await this.turn(before, release);
		return new MemoryTx(new Snap(this.state).raw, {
			commit: (writes) => this.apply(writes),
			end: release,
		});
	}

	/** Waits for `before`; on timeout gives the slot back once `before` ends, so the queue moves on. */
	private async turn(before: Promise<void>, release: () => void) {
		const ms = this.beginTimeoutMs;
		if (ms === undefined) return before;
		let timer: unknown;
		const late = new Promise<never>((_, reject) => {
			timer = timers.setTimeout(
				() =>
					reject(
						new TransactionError(
							`A transaction waited ${ms} ms for an earlier one to commit or roll back`,
						),
					),
				ms,
			);
		});
		try {
			await Promise.race([before, late]);
		} catch (e) {
			void before.then(release);
			throw e;
		} finally {
			timers.clearTimeout(timer);
		}
	}

	async transaction<R>(fn: (tx: Tx) => R | Promise<R>): Promise<R> {
		const tx = await this.begin();
		try {
			this.inCallback = true;
			let pending: R | Promise<R>;
			try {
				pending = fn(tx);
			} finally {
				this.inCallback = false;
			}
			const result = await pending;
			await tx.commit();
			return result;
		} finally {
			tx.rollback();
		}
	}

	private async apply(writes: Overlay) {
		const next: Record<TableName, Rows> = { ...this.state };
		const changes: Change[] = [];
		for (const [table, byRow] of writes) {
			const rows = new Map(this.state[table]);
			for (const [id, row] of byRow)
				if (row === null) {
					if (rows.delete(id)) changes.push({ table, id, row: null });
				} else {
					rows.set(id, row);
					changes.push({ table, id, row });
				}
			next[table] = rows;
		}
		if (changes.length === 0) return;
		await this.onCommit?.(changes);
		this.state = next;
	}
}
