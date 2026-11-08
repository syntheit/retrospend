/**
 * What a write changed, row by row. A recorder wraps the transaction's writer
 * and keeps the first state each touched row had, so the net change of a
 * write (a row put twice, or put and deleted again) is one before and one
 * after. Undo tokens and previews are both built from these.
 */
import { sameValue } from "./equal";
import {
	TABLE_NAMES,
	type TableName,
	type TableRows,
	type Writer,
} from "./port";

export type AnyRow = TableRows[TableName];

/** One row's state before and after a write; null is "not there". */
export interface RowChange {
	readonly table: TableName;
	readonly id: string;
	readonly before: AnyRow | null;
	readonly after: AnyRow | null;
}

export type ChangeKind = "create" | "edit" | "delete";

export const changeKind = (c: RowChange): ChangeKind =>
	c.before === null ? "create" : c.after === null ? "delete" : "edit";

export interface Recorder {
	readonly writer: Writer;
	/** The net changes so far, read from the live transaction, in table then id order. Rows put back to what they were are left out. */
	changes(): RowChange[];
}

/** The one place a row of any table is written; the port types a put per table. */
export function putAny(w: Writer, table: TableName, row: AnyRow) {
	w.put(table, row as never);
}

export function record(tx: Writer): Recorder {
	const first = new Map<
		string,
		{ table: TableName; id: string; before: AnyRow | null }
	>();
	const note = (table: TableName, id: string) => {
		const key = `${table}\u0000${id}`;
		if (!first.has(key))
			first.set(key, { table, id, before: tx.get(table, id) ?? null });
	};
	const writer: Writer = {
		get: (table, id) => tx.get(table, id),
		list: (table) => tx.list(table),
		put(table, row) {
			note(table, row.id);
			tx.put(table, row);
		},
		delete(table, id) {
			note(table, id);
			return tx.delete(table, id);
		},
	};
	return {
		writer,
		changes: () =>
			[...first.values()]
				.map((f) => ({ ...f, after: tx.get(f.table, f.id) ?? null }))
				.filter((c) => !sameValue(c.before, c.after))
				.sort(
					(a, b) =>
						TABLE_NAMES.indexOf(a.table) - TABLE_NAMES.indexOf(b.table) ||
						(a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
				),
	};
}
