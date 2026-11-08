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
	type Reader,
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

/** Callers keep no handle that could change a stored row. */
const owned = <T extends AnyRow>(row: T): T => Object.freeze({ ...row }) as T;

class Snap implements Snapshot {
	constructor(private readonly state: State) {}

	get<T extends TableName>(table: T, id: string) {
		return this.state[table].get(id) as TableRows[T] | undefined;
	}

	list<T extends TableName>(table: T) {
		return [...this.state[table].values()].sort(byId) as TableRows[T][];
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
		return this.view.get(table, id);
	}

	list<T extends TableName>(table: T) {
		this.live();
		return this.view.list(table);
	}

	put<T extends TableName>(table: T, row: TableRows[T]) {
		this.live();
		this.write(table, row.id, owned(row));
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
}

export class MemoryStore implements Store {
	private state: State;
	/** Settles when the newest transaction has ended. */
	private tail: Promise<void> = Promise.resolve();
	private readonly onCommit: MemoryStoreOptions["onCommit"];

	constructor(options: MemoryStoreOptions = {}) {
		this.onCommit = options.onCommit;
		const state = {} as Record<TableName, Rows>;
		for (const table of TABLE_NAMES) {
			const rows = new Map<string, AnyRow>();
			for (const row of options.rows?.[table] ?? [])
				rows.set(row.id, owned(row));
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
		const before = this.tail;
		let release!: () => void;
		this.tail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await before;
		return new MemoryTx(this.snapshot(), {
			commit: (writes) => this.apply(writes),
			end: release,
		});
	}

	async transaction<R>(fn: (tx: Tx) => R | Promise<R>): Promise<R> {
		const tx = await this.begin();
		try {
			const result = await fn(tx);
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
