import { toBookingInput } from "@retrospend/domain/expense-input";
import { CategoryChangedError } from "@retrospend/domain/category-version";
import { IdTakenError } from "@retrospend/domain/id-taken";
import { MissingRateError } from "@retrospend/domain/money";
import { dec } from "@retrospend/domain/precise-decimal";
import {
	RecurringInputRefusal,
	RecurringRefusal,
} from "@retrospend/domain/recurring-post/refusals";
import { dayKey } from "@retrospend/domain/time-zone";
import { budgetFamilyPulled } from "../budget-gate";
import { NotFoundError } from "../errors";
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
import { EXPENSE_FIGURES } from "../preview";
import { type TemplateRow, templateWithoutText } from "../templates";
import type { UndoToken } from "../undo";
import {
	type AccountOp,
	accountPlanOf,
	isAccountOp,
	wealthChangeOf,
} from "./account-book";
import {
	type CategoryOp,
	categoryChangeOf,
	categoryPlanOf,
	chainOnCategory,
	isCategoryOp,
	namedFieldsOf,
} from "./category-book";
import type { ExpenseChange, PendingChange, PendingEntry } from "./pending";
import { recurringPlanOf } from "./recurring-book";
import {
	type TemplateCreateBody,
	type TemplateUpdateBody,
	templatePlanOf,
} from "./template-book";
import { isTransferOp, type TransferOp, transferPlanOf } from "./transfer-book";

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

/**
 * One due period of a recurring template that a person confirms or skips. The
 * template is the row the write is about; `expenseId` is the id the posted
 * expense takes (the outbox entry's client id), so the device row and the
 * server's meet.
 */
export interface SettleBody {
	templateId: string;
	/** The due instant being settled (ISO). */
	dueAt: string;
}

export interface ConfirmBody extends SettleBody {
	expenseId: string;
	/** Decimal text: the real amount of an "Amount varies" template. */
	amount?: string;
	/** YYYY-MM-DD: the day it was really paid. */
	paidOn?: string;
	/**
	 * The poster's confirm: an auto post, which the template must still allow
	 * (auto-pay on, a fixed amount). The only confirm the device books for an
	 * income template, row only as the server's sweep posts it.
	 */
	auto?: true;
}

export type WriteOp =
	| { kind: "create" | "update"; body: WriteBody }
	| { kind: "delete"; id: string }
	| { kind: "confirm"; body: ConfirmBody }
	| { kind: "skip"; body: SettleBody }
	| { kind: "templateCreate"; body: TemplateCreateBody }
	| { kind: "templateUpdate"; body: TemplateUpdateBody }
	| AccountOp
	| TransferOp
	| CategoryOp;

/** The writes whose row is a recurring template. */
type TemplateOp = Extract<
	WriteOp,
	{ kind: "confirm" | "skip" | "templateCreate" | "templateUpdate" }
>;
const isTemplateOp = (op: WriteOp): op is TemplateOp =>
	op.kind === "confirm" ||
	op.kind === "skip" ||
	op.kind === "templateCreate" ||
	op.kind === "templateUpdate";

/** The row id the write is about: the expense, or the template of a confirm, skip, create or edit. */
export const targetOf = (op: WriteOp): string =>
	isAccountOp(op) || isTransferOp(op) || isCategoryOp(op)
		? op.body.id
		: op.kind === "delete"
			? op.id
			: op.kind === "confirm" || op.kind === "skip"
				? op.body.templateId
				: op.body.id;

/** The sync cursors a fee check and the budget gate read (the engine's own, by entity). */
export type WriteCursors = Readonly<Partial<Record<string, string>>>;

/** What an outbox entry keeps of a booking, and the version the write was based on. */
export interface BookedWrite {
	/** Epoch ms the device booked it. */
	bookedAt: number;
	/** Each expense, template, account, leg, snapshot, rate switch and transfer it changed, in order; empty when the device had no rate. */
	changes: PendingChange[];
	/** The body fields the person changed (names only). */
	changed: string[];
	/** The device had no rate: the server books it. */
	unbooked?: "no_rate";
	/**
	 * The `updatedAt` of the row as the overlay holds it, for an edit or a
	 * delete; null for a create, or for a row an unsent entry made. Null for an
	 * account write, whose base is `accountBase`.
	 */
	base: string | null;
	/**
	 * The version of the category as the overlay holds it, which the send names
	 * as `expectedVersion`; absent for a create or a write that is not a
	 * category's.
	 */
	categoryBase?: { version: number };
	/**
	 * The client ids of the unsent category entries (a create or an edit) this
	 * write names a category of, oldest first: an expense or template create or
	 * edit that files into it. The sender chains the write on them and parks it
	 * with them (name taken, id taken, category changed). Absent when the write
	 * names no category with an unsent entry.
	 */
	chainOn?: readonly string[];
	/**
	 * The version and stored balance of the account as the overlay holds it,
	 * which the send names as `expectedVersion` and `expectedBalance`; absent
	 * for a create or a write that is not an account's.
	 */
	accountBase?: { version: number; balance: string };
}

/**
 * The write function and the mutation id of `op`, over what `r` holds, with
 * the figures it moves. `now` is the clock a recurring period is read at.
 * Throws InvalidInputError.
 */
export function planOf(
	op: WriteOp,
	r: Reader,
	cursors: WriteCursors,
	now: Date,
): { id: string; touches: readonly string[]; write: WriteFn<unknown> } {
	if (isCategoryOp(op)) return categoryPlanOf(op);
	if (isAccountOp(op)) return accountPlanOf(op, now);
	if (isTransferOp(op))
		return transferPlanOf(op, now, budgetFamilyPulled(cursors));
	if (op.kind === "confirm" || op.kind === "skip")
		return recurringPlanOf(op, now);
	if (op.kind === "templateCreate" || op.kind === "templateUpdate")
		return templatePlanOf(op);
	const planned = expensePlanOf(op, r, cursors);
	return { ...planned, touches: EXPENSE_FIGURES };
}

function expensePlanOf(
	op: Exclude<WriteOp, TemplateOp | AccountOp | TransferOp | CategoryOp>,
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
 * The rows a write changed, in the order it changed them, as an outbox entry
 * keeps them: a recurring confirm changes an expense and a template, a
 * transfer its rows, its legs, its accounts and its fee. Never any text.
 */
export function bookedChangesOf(undo: UndoToken): PendingChange[] {
	const rows = undo.kind === "revert" ? undo.changes : [];
	const expenses = pendingChangesOf(undo);
	return rows.flatMap((c): PendingChange[] => {
		if (c.table === "expenses")
			return expenses.filter((e) => e.id === c.id).slice(0, 1);
		const wealth = wealthChangeOf(c);
		if (wealth) return [wealth];
		const category = categoryChangeOf(c);
		if (category) return [category];
		if (c.table !== "recurringTemplates") return [];
		return [
			{
				table: "recurringTemplates",
				id: c.id,
				before: c.before ? templateWithoutText(c.before as TemplateRow) : null,
				after: c.after ? templateWithoutText(c.after as TemplateRow) : null,
			},
		];
	});
}

/** The refusals a booking meets that are the domain's answer, not a fault: the server decides. */
export const isDeviceRefusal = (error: unknown): boolean =>
	error instanceof InvalidInputError ||
	error instanceof NotFoundError ||
	error instanceof IdTakenError ||
	error instanceof CategoryChangedError ||
	error instanceof RecurringRefusal ||
	error instanceof RecurringInputRefusal;

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
	/** The phone's unsent and unpulled entries, for the writes that chain on a category's. */
	pending: readonly PendingEntry[] = [],
): Promise<BookedWrite> {
	const { id, write } = planOf(op, tx, cursors, new Date(bookedAt));
	if (isCategoryOp(op)) return bookCategoryIn(tx, op, id, write, bookedAt);
	if (isAccountOp(op)) return bookAccountIn(tx, op, id, write, bookedAt);
	if (isTransferOp(op)) return bookTransferIn(tx, id, write, bookedAt);
	const row =
		op.kind === "create" || op.kind === "templateCreate"
			? undefined
			: isTemplateOp(op)
				? tx.get("recurringTemplates", targetOf(op))
				: tx.get("expenses", targetOf(op));
	const zone = tx.get("settings", SETTINGS_ID)?.timeZone ?? "";
	const named = categoryNamedBy(op);
	const chainOn = named ? chainOnCategory(pending, named) : [];
	const base = {
		bookedAt,
		base: row?.version ?? null,
		...(chainOn.length > 0 ? { chainOn } : {}),
	};
	const changed =
		op.kind === "update" && row
			? changedOf(row as ExpenseRow, op.body, zone)
			: [];
	try {
		const { undo } = await recordWrite(tx, id, write);
		const changes = bookedChangesOf(undo);
		return { ...base, changes, changed };
	} catch (error) {
		if (error instanceof MissingRateError)
			return { ...base, changes: [], changed, unbooked: "no_rate" };
		throw error;
	}
}

/**
 * The category an expense or template write files into (a create or an edit
 * that names one), which it may have to wait for. A bulk move names its own
 * (bulk.ts); a delete, a confirm and a skip name none of their own.
 */
const categoryNamedBy = (op: WriteOp): string | null | undefined =>
	op.kind === "create" ||
	op.kind === "update" ||
	op.kind === "templateCreate" ||
	op.kind === "templateUpdate"
		? op.body.categoryId
		: undefined;

/** `bookIn` for a category write: its row (never its name) is a change, and its base is the version the overlay holds. */
async function bookCategoryIn(
	tx: Writer,
	op: CategoryOp,
	id: string,
	write: WriteFn<unknown>,
	bookedAt: number,
): Promise<BookedWrite> {
	const category =
		op.kind === "categoryCreate" ? undefined : tx.get("categories", op.body.id);
	const { undo } = await recordWrite(tx, id, write);
	return {
		bookedAt,
		base: null,
		changed: namedFieldsOf(op),
		...(category ? { categoryBase: { version: category.version } } : {}),
		changes: bookedChangesOf(undo),
	};
}

/** `bookIn` for an account write: its rows are `wealth`, and its base is the account's version and balance. */
async function bookAccountIn(
	tx: Writer,
	op: AccountOp,
	id: string,
	write: WriteFn<unknown>,
	bookedAt: number,
): Promise<BookedWrite> {
	const account =
		op.kind === "accountCreate" ? undefined : tx.get("accounts", op.body.id);
	const base = {
		bookedAt,
		base: null,
		changed: [],
		...(account
			? { accountBase: { version: account.version, balance: account.balance } }
			: {}),
	};
	try {
		const { undo } = await recordWrite(tx, id, write);
		return { ...base, changes: bookedChangesOf(undo) };
	} catch (error) {
		if (error instanceof MissingRateError)
			return { ...base, changes: [], unbooked: "no_rate" };
		throw error;
	}
}

/**
 * `bookIn` for a transfer write: the fee's expense is a change like any
 * expense's, and the rest (the transfer, its legs, the accounts and snapshots
 * they moved) is `wealth`. A move the device cannot see whole refuses
 * (TransferOnlineError) and is not booked; a transfer has no version to send.
 */
async function bookTransferIn(
	tx: Writer,
	id: string,
	write: WriteFn<unknown>,
	bookedAt: number,
): Promise<BookedWrite> {
	const base = { bookedAt, base: null, changed: [] };
	try {
		const { undo } = await recordWrite(tx, id, write);
		return { ...base, changes: bookedChangesOf(undo) };
	} catch (error) {
		if (error instanceof MissingRateError)
			return { ...base, changes: [], unbooked: "no_rate" };
		throw error;
	}
}
