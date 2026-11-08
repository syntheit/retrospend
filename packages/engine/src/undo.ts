/**
 * Undo tokens for local writes, with the same two kinds as the server's
 * (preview/types.ts) and the same rule: an undo restores exactly the state
 * before the write, and only runs while the rows are still as the write left
 * them. Where the server compares an `updatedAt`, a local row has no stamp, so
 * the rows are compared by value; a conflict writes nothing.
 *
 * - revert: every row the write changed, with its state before and after.
 *   Undo puts the `before` rows back (a created row is deleted, a deleted row
 *   returns as it was). Needs each row to still equal its `after`.
 * - mirror: for writes that only append budget movements, which are never
 *   deleted. Undo books the opposite movements. Needs each movement to exist
 *   and not to have a mirror already.
 *
 * Undo is itself a write, so it returns the token that undoes it (redo): a
 * revert token with before and after swapped, or the mirror of the mirror.
 */
import { type AnyRow, putAny, type RowChange } from "./changes";
import { sameValue } from "./equal";
import { ConflictError } from "./errors";
import { type MovementRow, mirrorId, movementRepo } from "./movements";
import type { Writer } from "./port";

export type UndoToken =
	| {
			readonly kind: "revert";
			readonly mutation: string;
			readonly changes: readonly RowChange[];
	  }
	| {
			readonly kind: "mirror";
			readonly mutation: string;
			readonly movements: readonly MovementRow[];
	  };

/** The token for a write that changed `changes`. Appending movements only gets a mirror; anything else reverts. */
export function tokenFor(
	mutation: string,
	changes: readonly RowChange[],
): UndoToken {
	const appendsOnly =
		changes.length > 0 &&
		changes.every(
			(c) => c.table === "budgetMovements" && c.before === null && c.after,
		);
	return appendsOnly
		? {
				kind: "mirror",
				mutation,
				movements: changes.map((c) => c.after as MovementRow),
			}
		: { kind: "revert", mutation, changes };
}

const stale = (what: string, rows: RowChange[]) =>
	new ConflictError(
		`${what} changed since. Undo is no longer safe.`,
		rows.map((c) => ({ table: c.table, id: c.id })),
	);

/**
 * Applies `token` through `w` (a live transaction) and returns the redo
 * token. Checks every row before it writes any, so a conflict leaves the
 * transaction as it was.
 */
export function applyUndo(w: Writer, token: UndoToken): UndoToken {
	if (token.kind === "mirror") return applyMirror(w, token);
	const current = (c: RowChange): AnyRow | null => w.get(c.table, c.id) ?? null;
	const moved = token.changes.filter((c) => !sameValue(current(c), c.after));
	if (moved.length > 0) throw stale("These rows", moved);
	for (const c of token.changes)
		if (c.before === null) w.delete(c.table, c.id);
		else putAny(w, c.table, c.before);
	return {
		kind: "revert",
		mutation: token.mutation,
		changes: token.changes.map((c) => ({
			...c,
			before: c.after,
			after: c.before,
		})),
	};
}

function applyMirror(
	w: Writer,
	token: Extract<UndoToken, { kind: "mirror" }>,
): UndoToken {
	const stored = (m: MovementRow) => w.get("budgetMovements", m.id);
	const moved = token.movements.filter(
		(m) =>
			!sameValue(stored(m), m) ||
			w.get("budgetMovements", mirrorId(m.id)) !== undefined,
	);
	if (moved.length > 0)
		throw new ConflictError(
			"A movement changed or was already taken back. Undo is no longer safe.",
			moved.map((m) => ({ table: "budgetMovements", id: m.id })),
		);
	const book = movementRepo(w);
	return {
		kind: "mirror",
		mutation: token.mutation,
		movements: token.movements.map((m) => book.mirror(m.id)),
	};
}
