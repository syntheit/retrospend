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
import { expenseCategory } from "@retrospend/domain/expense-write/category";
import {
	CategoryNotFoundError,
	undoAfterHomeChange,
} from "@retrospend/domain/expense-write/refusals";
import { type AnyRow, putAny, type RowChange } from "./changes";
import { strayChildren } from "./children";
import { sameValue } from "./equal";
import { ConflictError } from "./errors";
import { type MovementRow, mirrorId, movementRepo } from "./movements";
import {
	InvalidInputError,
	SETTINGS_ID,
	type TableRows,
	type Writer,
} from "./port";
import { categoryKindOf } from "./reference";

type RevertToken = Extract<UndoToken, { kind: "revert" }>;

export type UndoToken =
	| {
			readonly kind: "revert";
			readonly mutation: string;
			readonly changes: readonly RowChange[];
			/**
			 * The home currency the write booked into, for a write whose undo puts
			 * back a rate quoted into it (an expense edit). The undo is refused once
			 * the home changed, as the server's signed edit undo is.
			 */
			readonly home?: string;
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
	home?: string,
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
		: {
				kind: "revert",
				mutation,
				changes,
				...(home === undefined ? {} : { home }),
			};
}

const stale = (what: string, rows: RowChange[]) =>
	new ConflictError(
		`${what} changed since. Undo is no longer safe.`,
		rows.map((c) => ({ table: c.table, id: c.id })),
	);

/** The expense row on one side of a change, when the change is of an expense. */
const expenseOf = (c: RowChange, side: "before" | "after") =>
	c.table === "expenses" && c[side] !== null
		? (c[side] as TableRows["expenses"])
		: null;

/**
 * An edit's undo (a token that pins the home) refuses what the server's edit
 * undo refuses, with its words: a home that changed since, and an old
 * category that is gone or no longer an expense category.
 */
function refuseEditUndo(w: Writer, token: RevertToken, home: string) {
	const row = token.changes
		.map((c) => expenseOf(c, "before"))
		.find((r) => r !== null);
	if (row && w.get("settings", SETTINGS_ID)?.homeCurrency !== home)
		throw new InvalidInputError(
			undoAfterHomeChange(row.rateType ?? null, row.homeCurrency ?? home),
		);
	for (const c of token.changes) {
		const before = expenseOf(c, "before");
		const after = expenseOf(c, "after");
		if (!before?.categoryId || !after || before.categoryId === after.categoryId)
			continue;
		try {
			expenseCategory(w.get("categories", before.categoryId), "not_found");
		} catch (e) {
			if (e instanceof CategoryNotFoundError)
				throw new InvalidInputError(e.message);
			throw e;
		}
	}
}

/**
 * A deleted expense comes back as it was, except that a category or template
 * deleted since is dropped, not invented (the server's restoreExpense), and
 * the category kind is read again.
 */
function restoredRow(w: Writer, c: RowChange): AnyRow | null {
	const row = expenseOf(c, "before");
	if (!row || c.after !== null) return c.before;
	return {
		...row,
		categoryKind: categoryKindOf(row.categoryId, (id) =>
			w.get("categories", id),
		),
		categoryId:
			row.categoryId && w.get("categories", row.categoryId)
				? row.categoryId
				: null,
		...(row.recurringTemplateId !== undefined && {
			recurringTemplateId:
				row.recurringTemplateId &&
				w.get("recurringTemplates", row.recurringTemplateId)
					? row.recurringTemplateId
					: null,
		}),
	};
}

/**
 * Applies `token` through `w` (a live transaction) and returns the redo
 * token. Checks every row before it writes any, so a conflict leaves the
 * transaction as it was.
 */
export function applyUndo(w: Writer, token: UndoToken): UndoToken {
	if (token.kind === "mirror") return applyMirror(w, token);
	if (token.home !== undefined) refuseEditUndo(w, token, token.home);
	const current = (c: RowChange): AnyRow | null => w.get(c.table, c.id) ?? null;
	const moved = token.changes.filter((c) => !sameValue(current(c), c.after));
	if (moved.length > 0) throw stale("These rows", moved);
	const stray = strayChildren(w, token.changes);
	if (stray.length > 0)
		throw new ConflictError(
			"Rows were added to this since. Undo is no longer safe.",
			stray,
		);
	// What is written, so the redo expects exactly it.
	const restored = token.changes.map((c) => ({
		...c,
		before: restoredRow(w, c),
	}));
	for (const c of restored)
		if (c.before === null) w.delete(c.table, c.id);
		else putAny(w, c.table, c.before);
	return {
		kind: "revert",
		mutation: token.mutation,
		changes: restored.map((c) => ({
			...c,
			before: c.after,
			after: c.before,
		})),
		...(token.home === undefined ? {} : { home: token.home }),
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
