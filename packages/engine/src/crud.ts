/** Row access the repositories share: one table, by id, with the checks every write makes. */
import { NotFoundError } from "./errors";
import {
	InvalidInputError,
	type Reader,
	type TableName,
	type TableRows,
	type Writer,
} from "./port";

export function tableReads<T extends TableName>(r: Reader, table: T) {
	return {
		get: (id: string): TableRows[T] | undefined => r.get(table, id),
		list: (): readonly TableRows[T][] => r.list(table),
	};
}

export function tableWrites<T extends TableName>(w: Writer, table: T) {
	return {
		...tableReads(w, table),
		/** Adds a row; an id already in use throws InvalidInputError. */
		insert(row: TableRows[T]) {
			if (w.get(table, row.id) !== undefined)
				throw new InvalidInputError(`${table} ${row.id} already exists`);
			w.put(table, row);
		},
		/** Replaces a row that exists; a missing one throws NotFoundError. */
		replace(row: TableRows[T]) {
			if (w.get(table, row.id) === undefined)
				throw new NotFoundError(`${table} ${row.id} does not exist`);
			w.put(table, row);
		},
		/** True when the row existed. */
		remove: (id: string) => w.delete(table, id),
	};
}
