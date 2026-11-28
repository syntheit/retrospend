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
	bookedInOtherHome,
	CategoryNotFoundError,
	UNDO_NOT_VALID,
	undoAfterHomeChange,
} from "@retrospend/domain/expense-write/refusals";
import { CUSTOM_RATE_TYPE } from "@retrospend/domain/rate-booking";
import { type AnyRow, putAny, type RowChange } from "./changes";
import { strayChildren } from "./children";
import { sameValue } from "./equal";
import { ConflictError } from "./errors";
import { type MovementRow, mirrorId, movementRepo } from "./movements";
import {
	InvalidInputError,
	SETTINGS_ID,
	type TableName,
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

/** What an undo says when a row was added under the thing it would take back. */
export const ROWS_ADDED_MESSAGE =
	"Rows were added to this since. Undo is no longer safe.";

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
 * undo refuses, in its order and with its words: a typed rate into a home
 * the person no longer has (the server's afterRead check), then an old
 * category that is gone or no longer an expense category, then a table rate
 * whose home changed since (the signed figures no longer fit).
 */
function refuseEditUndo(w: Writer, token: RevertToken, home: string) {
	const row = token.changes
		.map((c) => expenseOf(c, "before"))
		.find((r) => r !== null);
	const current = w.get("settings", SETTINGS_ID)?.homeCurrency;
	if (
		row?.rateType === CUSTOM_RATE_TYPE &&
		current !== undefined &&
		bookedInOtherHome(row.homeCurrency, current)
	)
		throw new InvalidInputError(
			undoAfterHomeChange(row.rateType, row.homeCurrency),
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
	// The signed figures were made under another home: the server's wording,
	// whatever the rate type (a typed rate into today's home reaches this too).
	if (row && current !== home) throw new InvalidInputError(UNDO_NOT_VALID);
}

/**
 * A row a write moved out of a category gets it back, unless it is gone or
 * no longer an expense category: then the row goes back uncategorized, as the
 * server's lenient categorize undo does. An edit's token never reaches here
 * with such a category (refuseEditUndo refuses it first, with its words).
 */
function withoutGoneCategory(
	w: Writer,
	c: RowChange,
	row: TableRows["expenses"],
): AnyRow {
	const after = expenseOf(c, "after");
	if (!row.categoryId || !after || row.categoryId === after.categoryId)
		return row;
	try {
		expenseCategory(w.get("categories", row.categoryId), "not_found");
		return row;
	} catch (e) {
		if (e instanceof CategoryNotFoundError)
			return { ...row, categoryId: null, categoryKind: null };
		throw e;
	}
}

/**
 * A deleted expense comes back as it was, except that a category or template
 * deleted since is dropped, not invented (the server's restoreExpense), and
 * the category kind is read again.
 */
function restoredRow(w: Writer, c: RowChange): AnyRow | null {
	const row = expenseOf(c, "before");
	if (!row) return c.before;
	if (c.after !== null) return withoutGoneCategory(w, c, row);
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

export interface ApplyOptions {
	/**
	 * Whether a stored row is the one a change expects; by value when absent.
	 * `table` names the row's table, for a check that reads one table's columns.
	 */
	readonly matches?: (
		current: AnyRow | null,
		expected: AnyRow | null,
		table: TableName,
	) => boolean;
	/** The row to write for `c` where it is not just its own side (a restored row, text laid over a stored one). */
	readonly rowFor?: (c: RowChange, current: AnyRow | null) => AnyRow | null;
	/** Refusals that read the whole set; run after the check and before any write. */
	readonly refuse?: () => void;
}

/**
 * Moves rows from one side of `changes` to the other through `w`: every row
 * must be as `from` says (`before` or `after`) and the other side is written.
 * The one replay under undo (`from: "after"`, the rows are as the write left
 * them) and the overlay read (`from: "before"`, the rows are as the write
 * found them). Checks every row before it writes any, so a conflict leaves the
 * transaction as it was. Returns the changes with the written side as written.
 */
export function applyChanges(
	w: Writer,
	changes: readonly RowChange[],
	from: "before" | "after",
	options: ApplyOptions = {},
): RowChange[] {
	const matches = options.matches ?? ((a, b) => sameValue(a, b));
	const current = (c: RowChange): AnyRow | null => w.get(c.table, c.id) ?? null;
	const moved = changes.filter((c) => !matches(current(c), c[from], c.table));
	if (moved.length > 0) throw stale("These rows", moved);
	options.refuse?.();
	// What is written, so a redo expects exactly it.
	const written: RowChange[] = changes.map((c) => {
		const row = options.rowFor
			? options.rowFor(c, current(c))
			: c[from === "after" ? "before" : "after"];
		return from === "after" ? { ...c, before: row } : { ...c, after: row };
	});
	for (const c of written) {
		const row = from === "after" ? c.before : c.after;
		if (row === null) w.delete(c.table, c.id);
		else putAny(w, c.table, row);
	}
	return written;
}

/**
 * Applies `token` through `w` (a live transaction) and returns the redo
 * token. Checks every row before it writes any, so a conflict leaves the
 * transaction as it was.
 */
export function applyUndo(w: Writer, token: UndoToken): UndoToken {
	if (token.kind === "mirror") return applyMirror(w, token);
	if (token.home !== undefined) refuseEditUndo(w, token, token.home);
	const restored = applyChanges(w, token.changes, "after", {
		refuse() {
			const stray = strayChildren(w, token.changes);
			if (stray.length > 0) throw new ConflictError(ROWS_ADDED_MESSAGE, stray);
		},
		rowFor: (c) => restoredRow(w, c),
	});
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
