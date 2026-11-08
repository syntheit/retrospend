/**
 * Budget movements are append-only: a movement is booked and never edited or
 * deleted, so two devices never conflict on one. Taking one back books its
 * mirror, the same amount the other way.
 */
import { tableReads, tableWrites } from "./crud";
import { ConflictError, NotFoundError } from "./errors";
import type { Reader, TableRows, Writer } from "./port";

export type MovementRow = TableRows["budgetMovements"];

/** The id of the movement that takes `id` back; one mirror per movement. */
export const mirrorId = (id: string) => `${id}:mirror`;

export function movementReads(r: Reader) {
	const movements = tableReads(r, "budgetMovements");
	return {
		...movements,
		inMonth: (month: number): MovementRow[] =>
			movements.list().filter((m) => m.month === month),
	};
}

export function movementRepo(w: Writer) {
	const reads = movementReads(w);
	const movements = tableWrites(w, "budgetMovements");
	return {
		...reads,
		/** Appends a movement; an existing id throws InvalidInputError. */
		book: (row: MovementRow) => movements.insert(row),
		/** Books the movement that takes `id` back and returns it. */
		mirror(id: string): MovementRow {
			const row = movements.get(id);
			if (!row) throw new NotFoundError(`budgetMovements ${id} does not exist`);
			const back: MovementRow = {
				...row,
				id: mirrorId(id),
				fromEnvelopeId: row.toEnvelopeId,
				toEnvelopeId: row.fromEnvelopeId,
			};
			if (movements.get(back.id))
				throw new ConflictError("This movement was already taken back", [
					{ table: "budgetMovements", id },
				]);
			movements.insert(back);
			return back;
		},
	};
}
