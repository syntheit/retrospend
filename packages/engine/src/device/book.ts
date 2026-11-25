import { toBookingInput } from "@retrospend/domain/expense-input";
import { MissingRateError } from "@retrospend/domain/money";
import { dec } from "@retrospend/domain/precise-decimal";
import { dayKey } from "@retrospend/domain/time-zone";
import { createExpense, EXPENSE_CREATE } from "../expense-create";
import {
	deleteExpense,
	EXPENSE_DELETE,
	EXPENSE_UPDATE,
	updateExpense,
} from "../expense-write-local";
import { type ExpenseRow, withoutText } from "../expenses";
import { recordWrite, type WriteFn } from "../local-db";
import {
	InvalidInputError,
	type Reader,
	SETTINGS_ID,
	type Writer,
} from "../port";
import type { UndoToken } from "../undo";
import type { ExpenseChange } from "./pending";

// What the phone saves, as the device books it: the same engine mutations a
// preview runs, over the pending writes, in a transaction that is thrown away
// (the store keeps only what pulls bring). The result is what the outbox entry
// carries (`device`), and what the preview compare reads (`planOf`).

/** The fields of a POST or PUT body that decide a booking, and the text. */
export interface WriteBody {
	id: string;
	title: string;
	/** Decimal text. */
	amount: string;
	currency: string;
	/** YYYY-MM-DD in the account's zone. */
	date: string;
	categoryId?: string;
	rateType?: string;
	/** A typed rate as decimal text. */
	customRate?: string;
	description?: string;
	location?: string;
	excludeFromAnalytics?: boolean;
	amortizeOver?: number;
}

export type WriteOp =
	| { kind: "create" | "update"; body: WriteBody }
	| { kind: "delete"; id: string };

export const targetOf = (op: WriteOp): string =>
	op.kind === "delete" ? op.id : op.body.id;

/** The sync cursors a fee check reads (the engine's own). */
export type WriteCursors = Readonly<
	Partial<Record<"expenses" | "transfers", string>>
>;

/** What an outbox entry keeps of a booking, and the version the write was based on. */
export interface BookedWrite {
	/** Epoch ms the device booked it. */
	bookedAt: number;
	/** Each expense it changed; empty when the device had no rate. */
	changes: ExpenseChange[];
	/** The body fields the person changed (names only). */
	changed: string[];
	/** The device had no rate: the server books it. */
	unbooked?: "no_rate";
	/**
	 * The `updatedAt` of the row as the overlay holds it, for an edit or a
	 * delete; null for a create, or for a row an unsent entry made.
	 */
	base: string | null;
}

/** The write function and the mutation id of `op`, over what `r` holds. Throws InvalidInputError. */
export function planOf(
	op: WriteOp,
	r: Reader,
	cursors: WriteCursors,
): { id: string; write: WriteFn<ExpenseRow> } {
	if (op.kind === "delete")
		return {
			id: EXPENSE_DELETE,
			write: deleteExpense({ id: op.id, cursors }),
		};
	const settings = r.get("settings", SETTINGS_ID);
	if (!settings) throw new InvalidInputError("no_settings");
	const input = toBookingInput(op.body, settings.timeZone);
	if (op.kind === "update")
		return {
			id: EXPENSE_UPDATE,
			write: updateExpense({ ...input, cursors }),
		};
	const category = op.body.categoryId
		? r.get("categories", op.body.categoryId)
		: undefined;
	// The device books only what it can see: a category it has not pulled is a refusal.
	if (op.body.categoryId && !category)
		throw new InvalidInputError("unknown_category");
	return {
		id: EXPENSE_CREATE,
		write: createExpense({
			...input,
			...(category
				? {
						category: {
							id: category.id,
							kind: category.kind,
							excludeByDefault: category.excludeByDefault,
						},
					}
				: {}),
		}),
	};
}

/**
 * The body fields an edit changes, by name. Over-listing is safe (a re-base
 * puts this phone's value over the newer one); a missed name loses a change.
 * A typed rate is always listed: the row does not say what was typed.
 */
function changedOf(row: ExpenseRow, body: WriteBody, zone: string): string[] {
	const text = (v: string | null | undefined) => v ?? "";
	const changed: [string, boolean][] = [
		["title", row.title !== body.title],
		["description", text(row.description) !== text(body.description)],
		["location", text(row.location) !== text(body.location)],
		["amount", !dec(row.amount).eq(dec(body.amount))],
		["currency", row.currency !== body.currency],
		["date", dayKey(row.date, zone) !== body.date],
		["categoryId", text(row.categoryId) !== text(body.categoryId)],
		[
			"excludeFromAnalytics",
			body.excludeFromAnalytics !== undefined &&
				body.excludeFromAnalytics !== row.excludeFromAnalytics,
		],
		["rateType", body.rateType !== undefined && body.rateType !== row.rateType],
		["customRate", body.customRate !== undefined],
	];
	return changed.flatMap(([name, differs]) => (differs ? [name] : []));
}

/** The expense rows a write changed, as an outbox entry keeps them. An expense write always reverts (a mirror token is for budget movements). */
export function pendingChangesOf(undo: UndoToken): ExpenseChange[] {
	const rows = undo.kind === "revert" ? undo.changes : [];
	return rows.flatMap((c): ExpenseChange[] =>
		c.table === "expenses"
			? [
					{
						table: "expenses",
						id: c.id,
						before: c.before ? withoutText(c.before as ExpenseRow) : null,
						after: c.after ? withoutText(c.after as ExpenseRow) : null,
					},
				]
			: [],
	);
}

/**
 * Books `op` in `tx` (a transaction the caller throws away). A refusal throws
 * InvalidInputError or NotFoundError; a missing rate is `unbooked`, never a
 * booking at 1 or 0.
 */
export async function bookIn(
	tx: Writer,
	op: WriteOp,
	cursors: WriteCursors,
	bookedAt: number,
): Promise<BookedWrite> {
	const { id, write } = planOf(op, tx, cursors);
	const row =
		op.kind === "create" ? undefined : tx.get("expenses", targetOf(op));
	const zone = tx.get("settings", SETTINGS_ID)?.timeZone ?? "";
	const base = { bookedAt, base: row?.version ?? null };
	const changed =
		op.kind === "update" && row ? changedOf(row, op.body, zone) : [];
	try {
		const { undo } = await recordWrite(tx, id, write);
		const changes = pendingChangesOf(undo);
		return { ...base, changes, changed };
	} catch (error) {
		if (error instanceof MissingRateError)
			return { ...base, changes: [], changed, unbooked: "no_rate" };
		throw error;
	}
}
