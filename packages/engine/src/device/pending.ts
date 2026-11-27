import { ackedTableOf } from "@retrospend/domain/recurring-post/acked-table";
import { filterFieldsOf } from "../budget-book";
import type { RowChange } from "../changes";
import { ConflictError } from "../errors";
import {
	type ExpenseRow,
	type TextFreeExpenseRow,
	withoutText,
} from "../expenses";
import type { Store, TableName, Tx, Writer } from "../port";
import {
	type TemplateRow,
	type TextFreeTemplateRow,
	templateWithoutText,
} from "../templates";
import { applyChanges } from "../undo";
import { differingColumns } from "../wealth-columns";
import {
	isWealthTable,
	type WealthChange,
	type WealthTable,
} from "../wealth-rows";
import { sameColumnValue } from "../write-parity";

// Writes the device has booked and the server has not shown back yet, read
// as an overlay for the three readers that need them (the device preview, the
// write compare and the K9 swap gate). Never for a screen: a figure on screen
// is the server's (AGENTS 6.1), so the engine's own reads and its compare run
// over the store a pull left, and only `readWithPending` lays entries over it.
//
// The phone owns the lists (outbox and acked, in one order) and hands them in
// through `PendingSource`; this file owns what an entry has to carry, which
// entries count, and how they are replayed.

/** One expense an entry changed, as the device booked it: no title, description or location. */
export interface ExpenseChange {
	readonly table: "expenses";
	readonly id: string;
	readonly before: TextFreeExpenseRow | null;
	readonly after: TextFreeExpenseRow | null;
}

/** One recurring template an entry changed: no name, website or payment source, and no joined category. */
export interface TemplateChange {
	readonly table: "recurringTemplates";
	readonly id: string;
	readonly before: TextFreeTemplateRow | null;
	readonly after: TextFreeTemplateRow | null;
}

/**
 * One account, leg, snapshot, rate switch or transfer row an entry changed:
 * an account without its name, a transfer without its note (wealth-rows.ts).
 */
export type { WealthChange };

export type PendingChange = ExpenseChange | TemplateChange | WealthChange;

/** One write in the outbox or the acked list; the engine reads it and never changes it. */
export interface PendingEntry {
	readonly clientId: string;
	/** Epoch ms the device booked it: the compare's `rates_moved` clock. */
	readonly bookedAt: number;
	/** Each row it changed, in the order the device changed them. Empty for an `unbooked` entry. */
	readonly changes: readonly PendingChange[];
	/** The names of the fields the person changed. The phone's re-base reads it; the overlay does not. */
	readonly changed: readonly string[];
	/** Waiting for the person: its send was refused. Its rows may never reach the server. */
	readonly parked: boolean;
	/** The device could not book it (no rate); the server will, and the overlay never counts it. */
	readonly unbooked?: "no_rate";
	/**
	 * Set once the server accepted it, which moves it to the acked list. An
	 * entry stacked on it then has `version` of its `before` rows set to
	 * `ack.version`, which is how the overlay finds its base.
	 */
	readonly ack?: {
		/** The `updatedAt` the answer named for the row, null for a delete. */
		readonly version: string | null;
		/** A recurring confirm's booked expense, which `version` (the template's) does not name; absent from a server before contract 1.12.0. */
		readonly expenseVersion?: string;
		/**
		 * `DeviceEngine.pullsBegun` when the ack arrived. A pull that began
		 * after it has seen the write; one that was running then may not have.
		 * A list loaded from disk restarts at 0, so the first pull of a run
		 * retires what the last run left.
		 */
		readonly pull: number;
	};
}

/** What the phone gives the engine to read its pending writes and to settle the ones a pull retired. */
export interface PendingSource {
	/** Reads the phone's lists again; the engine awaits it before each pull begins. */
	refresh?(): Promise<void>;
	/** The outbox and the acked list in one order, oldest first. */
	entries(): readonly PendingEntry[];
	/** Takes `clientIds` out of the acked list: a pull compared them. */
	retire(clientIds: readonly string[]): void;
	/** Entries that left the list without a pull (undone, or aged out), once each. */
	takeLeft(): readonly {
		readonly entry: PendingEntry;
		readonly code: "undone" | "expired";
	}[];
}

/** The text a created row has in an overlay: the device keeps none, so it never shows. */
export const CREATE_TEXT = { title: "", description: null, location: null };

/** The same for a created template: no name, website, payment source or category. */
export const CREATE_TEMPLATE_TEXT = {
	name: "",
	websiteUrl: null,
	paymentSource: null,
	category: null,
};

/** The same for a created account: no name. */
export const CREATE_ACCOUNT_TEXT = { name: "" };

/** The same for a created transfer: no note. */
export const CREATE_TRANSFER_TEXT = { note: null };

/**
 * Whether the overlay replays `entry`. A parked entry may never be sent and an
 * unbooked one has no device booking, so neither counts. An acked one counts
 * until a pull that began after its ack has finished: from then on the store
 * holds the server's row. `settledPull` is the number of the latest finished
 * pull in `DeviceEngine.pullsBegun` terms (0 before any).
 */
export function countsInOverlay(entry: PendingEntry, settledPull: number) {
	if (entry.parked || entry.unbooked) return false;
	return entry.ack === undefined || settledPull <= entry.ack.pull;
}

/** The acked entries a finished pull has seen: compared, then retired. */
export const retiredBy = (
	entries: readonly PendingEntry[],
	settledPull: number,
) =>
	entries.filter(
		(e) =>
			e.ack !== undefined &&
			!e.parked &&
			!e.unbooked &&
			settledPull > e.ack.pull,
	);

/**
 * A row with the columns a device-created row may lack (the sync sets them)
 * at their defaults, through the one owner of those defaults.
 */
function settled(row: TextFreeExpenseRow): Record<string, unknown> {
	const f = filterFieldsOf(row as ExpenseRow);
	return {
		...row,
		keepInWealth: f.keepInWealth,
		isAmortizedChild: f.isAmortizedChild,
		parentId: f.parentId,
		amortizeMode: f.amortizeMode,
		recurringTemplateId: row.recurringTemplateId ?? null,
		budgetEnvelopeId: row.budgetEnvelopeId ?? null,
	};
}

/** The text a created row of `table` has in an overlay (none for rows without text). */
function createTextOf(table: TableName): Record<string, unknown> {
	switch (table) {
		case "recurringTemplates":
			return CREATE_TEMPLATE_TEXT;
		case "accounts":
			return CREATE_ACCOUNT_TEXT;
		case "transfers":
			return CREATE_TRANSFER_TEXT;
		case "legs":
		case "snapshots":
		case "rateSwitches":
			return {};
		default:
			return CREATE_TEXT;
	}
}

/** An account's version is a number; every other row's is the `updatedAt` text. */
const ackedVersion = (table: TableName, version: string) =>
	table === "accounts" ? Number(version) : version;

/**
 * Whether the stored expense is the one an entry's `before` names: every
 * column the device keeps, decimals by value (a pulled row's text is the
 * server's, a device-booked row's is the column's scale), the rest exactly.
 */
function isBeforeExpense(current: unknown, expected: unknown): boolean {
	if (current === null || expected === null) return current === expected;
	const stored = settled(withoutText(current as ExpenseRow));
	const wanted = settled(expected as TextFreeExpenseRow);
	return [...new Set([...Object.keys(stored), ...Object.keys(wanted)])].every(
		(column) => sameColumnValue(column, stored[column], wanted[column]),
	);
}

/**
 * The same for a template, over the columns the device keeps outside the
 * store. A column the outbox's round trip dropped (undefined) is a null one.
 */
function isBeforeTemplate(current: unknown, expected: unknown): boolean {
	if (current === null || expected === null) return current === expected;
	const stored: Record<string, unknown> = templateWithoutText(
		current as TemplateRow,
	);
	const wanted = expected as Record<string, unknown>;
	return [...new Set([...Object.keys(stored), ...Object.keys(wanted)])].every(
		(column) =>
			sameColumnValue(column, stored[column] ?? null, wanted[column] ?? null),
	);
}

/**
 * The same for the account family, over every column the device keeps, except
 * an account's `version`: it is the server's, a placeholder on the device
 * until the ack names it, and another entry (a transfer through the account)
 * holds the account as the placeholder had it. The version is checked at send
 * (expectedVersion), and a changed account differs in a column anyway.
 */
function isBeforeWealth(
	current: unknown,
	expected: unknown,
	table: WealthTable,
): boolean {
	if (current === null || expected === null) return current === expected;
	return (
		differingColumns(
			table,
			current as object,
			expected as object,
			BEFORE_SKIPPED[table] ?? [],
		).length === 0
	);
}

/** Columns a stored row has that an entry's text-free row does not, or that the ack names (the version). */
const BEFORE_SKIPPED: Partial<Record<WealthTable, readonly string[]>> = {
	accounts: ["name", "version"],
	transfers: ["note"],
};

const isBefore = (current: unknown, expected: unknown, table: TableName) =>
	table === "recurringTemplates"
		? isBeforeTemplate(current, expected)
		: isWealthTable(table)
			? isBeforeWealth(current, expected, table)
			: isBeforeExpense(current, expected);

/**
 * Replays one entry over `tx`. A row it would change must equal its `before`
 * on every column the device keeps, as the entries before it left it (so a
 * chain is held against the row its predecessor wrote, not the store's). Any
 * row that does not (a pull brought a newer one, another entry moved it)
 * leaves the whole entry out and the store as it was, so a posted expense is
 * never shown beside a template that has not moved. An edit lays its fields
 * over the stored row, so the text stays the store's; a create has the fixed
 * placeholder text.
 *
 * An acked entry's `ack.version` is the server's version of the row it names:
 * the template's for an entry that changed one (a confirm or skip answers with
 * the template's), the expense's otherwise.
 */
function replay(tx: Writer, entry: PendingEntry) {
	const versioned = ackedTableOf(entry.changes);
	try {
		applyChanges(tx, entry.changes as readonly RowChange[], "before", {
			matches: isBefore,
			rowFor: (c, current) => {
				if (c.after === null) return null;
				return {
					...(current ?? createTextOf(c.table)),
					...c.after,
					...(entry.ack?.version && c.table === versioned
						? { version: ackedVersion(c.table, entry.ack.version) }
						: {}),
				} as RowChange["after"];
			},
		});
	} catch (error) {
		if (!(error instanceof ConflictError)) throw error;
	}
}

/** Thrown after the read ran, so its transaction rolls back instead of committing. */
class Discard extends Error {}

/**
 * Runs `read` over `store` with every entry that counts replayed in order, in
 * a transaction that is thrown away: the store is exactly as it was.
 */
export async function readOverlaid<R>(
	store: Store,
	entries: readonly PendingEntry[],
	settledPull: number,
	read: (view: Tx) => R | Promise<R>,
): Promise<R> {
	let result: { value: R } | undefined;
	try {
		await store.transaction(async (tx) => {
			for (const entry of entries)
				if (countsInOverlay(entry, settledPull)) replay(tx, entry);
			result = { value: await read(tx) };
			throw new Discard();
		});
	} catch (error) {
		if (!(error instanceof Discard)) throw error;
	}
	return (result as { value: R }).value;
}
