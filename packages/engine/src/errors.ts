import type { TableName } from "./port";

/** A row the write needs is not there. */
export class NotFoundError extends Error {
	override readonly name = "NotFoundError";
}

/**
 * The rows are not in the state the write expected: an undo met rows that
 * changed after the write, or a mirror was already booked. Nothing was written.
 * `rows` names them, so a toast can say which expense moved.
 */
export class ConflictError extends Error {
	override readonly name = "ConflictError";
	constructor(
		message: string,
		readonly rows: readonly { table: TableName; id: string }[],
	) {
		super(message);
	}
}
