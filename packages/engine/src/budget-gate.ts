/**
 * When a device may read the budget figures (E2EE P13b). The budget block
 * (GET /sync/shares?budget=1) is exact at one sync position, its `asOf`; the
 * rows the figures read come from the cursor pulls. The block is usable only
 * once every cursor the device holds has reached that position, and only
 * while the book it was made for is the book the device holds: same
 * valuation key, same id. Until then the last block that passed keeps serving
 * (budget-snapshot.ts); with none, or after a sync reset that dropped rows, the
 * figures read unavailable and `budgetStatus` says "stale", which is not the
 * same as "none" (a person with no budget).
 *
 * The cursors live in the sync client, not in the store, so the caller hands
 * them in: the cursor each entity's pull ended on (a pull that has no more
 * pages), or SYNC_RESET while an entity is being re-pulled after a 410.
 */
import { bookValuationKey } from "@retrospend/domain/envelope/book-valuation-key";
import type { FigurePass } from "@retrospend/domain/figures/registry";
import { promotePendingBudget } from "./budget-snapshot";
import { rowsIn } from "./pass-reads";
import {
	BUDGET_SNAPSHOT_ID,
	type Reader,
	type TableRows,
	type Writer,
} from "./port";

/** Every entity whose rows the budget figures read: a block is not exact for the device until each has caught up. */
export const BUDGET_GATE_ENTITIES = [
	"expenses",
	"categories",
	"recurringTemplates",
	"accounts",
	"budgetBooks",
	"envelopeGroups",
	"envelopes",
	"envelopeCategories",
	"budgetMovements",
	"bookPeriods",
	"monthCloses",
	"wealthTransfers",
	"payoffPlans",
	"transfers",
] as const;

export type BudgetGateEntity = (typeof BUDGET_GATE_ENTITIES)[number];

/** An entity answered 410 and is being pulled again from the start: nothing it holds can be trusted yet. */
export const SYNC_RESET = "reset";

export type EntityCursor = string | typeof SYNC_RESET;
export type EntityCursors = Partial<Record<BudgetGateEntity, EntityCursor>>;

interface Position {
	epoch: string;
	/** The transaction position, as digits. */
	t: string;
}

const B64URL =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** The text of a base64url token made of ASCII, or null: the engine has no atob and no Buffer. */
function asciiOf(token: string): string | null {
	let bits = 0;
	let held = 0;
	let out = "";
	for (const ch of token) {
		const v = B64URL.indexOf(ch);
		if (v < 0) return null;
		bits = (bits << 6) | v;
		held += 6;
		if (held >= 8) {
			held -= 8;
			const byte = (bits >> held) & 0xff;
			if (byte > 0x7f) return null;
			out += String.fromCharCode(byte);
			bits &= (1 << held) - 1;
		}
	}
	return out;
}

/** The epoch and transaction position of a sync cursor ({e, t, s} as base64url JSON), or null for anything else. */
export function cursorPosition(token: string): Position | null {
	const text = asciiOf(token);
	if (text === null) return null;
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null) return null;
	const { e, t } = value as Record<string, unknown>;
	if (typeof e !== "string" || e === "") return null;
	if (typeof t !== "string" || !/^\d{1,20}$/.test(t)) return null;
	return { epoch: e, t };
}

/** Digit strings compared as numbers, without BigInt. */
function atLeast(a: string, b: string): boolean {
	const x = a.replace(/^0+(?=\d)/, "");
	const y = b.replace(/^0+(?=\d)/, "");
	return x.length !== y.length ? x.length > y.length : x >= y;
}

/** The synced personal book (a person has one; a shared book is never synced) and what its valuations depend on. */
export function syncedBook(
	db: Reader,
	pass?: FigurePass,
): { id: string; key: string } | null {
	const book = rowsIn(db, pass, "budgetBooks")[0];
	if (!book) return null;
	return {
		id: book.id,
		key: bookValuationKey({
			currency: book.currency,
			timeZone: book.timeZone,
			startDate: book.startDate,
			periods: rowsIn(db, pass, "bookPeriods").filter(
				(p) => p.bookId === book.id,
			),
		}),
	};
}

export type GateReason =
	/** No block waits. */
	| "no-pending"
	/** The block's own position is not a cursor. */
	| "malformed"
	/** An entity is being pulled again after a 410. */
	| "reset"
	/** An entity has no cursor yet, one that is not ours, or one below the block's position. */
	| "cursors"
	/** The book changed since the block was made, or the device holds none. */
	| "key";

export type GateResult =
	| { readonly passes: true }
	| { readonly passes: false; readonly reason: GateReason };

/**
 * Whether a block can be read: every entity's cursor has the block's epoch and
 * a transaction position at or above its own, no entity is mid-reset, and the
 * book the device holds is the one the block was made for.
 */
export function budgetGate(p: {
	pending: Pick<
		TableRows["budgetSnapshot"],
		"asOf" | "bookId" | "valuationKey"
	>;
	book: { id: string; key: string } | null;
	cursors: EntityCursors;
}): GateResult {
	const at = cursorPosition(p.pending.asOf);
	if (!at) return { passes: false, reason: "malformed" };
	let waiting = false;
	for (const entity of BUDGET_GATE_ENTITIES) {
		const cursor = p.cursors[entity];
		if (cursor === SYNC_RESET) return { passes: false, reason: "reset" };
		const position = cursor === undefined ? null : cursorPosition(cursor);
		if (!position || position.epoch !== at.epoch || !atLeast(position.t, at.t))
			waiting = true;
	}
	if (waiting) return { passes: false, reason: "cursors" };
	if (
		!p.book ||
		p.book.id !== p.pending.bookId ||
		p.book.key !== p.pending.valuationKey
	)
		return { passes: false, reason: "key" };
	return { passes: true };
}

/**
 * Moves the pending block into the active snapshot when its gate passes, in
 * `tx`. Call it after each pull that could have moved a cursor or the book.
 */
export function promoteBudgetIfReady(
	tx: Writer,
	cursors: EntityCursors,
): { promoted: boolean; reason?: GateReason } {
	const pending = tx.get("budgetSnapshotPending", BUDGET_SNAPSHOT_ID);
	if (!pending) return { promoted: false, reason: "no-pending" };
	const gate = budgetGate({ pending, book: syncedBook(tx), cursors });
	if (!gate.passes) return { promoted: false, reason: gate.reason };
	return { promoted: promotePendingBudget(tx) };
}

/**
 * An entity answered 410 and its rows were dropped: the active snapshot was
 * made for rows the device no longer holds, so it goes, and the figures read
 * unavailable until the re-pull ends and the pending block passes its gate.
 * The pending block stays. True when it dropped one.
 */
export function dropBudgetOnReset(tx: Writer, entity: string): boolean {
	if (!(BUDGET_GATE_ENTITIES as readonly string[]).includes(entity))
		return false;
	return tx.delete("budgetSnapshot", BUDGET_SNAPSHOT_ID);
}

/**
 * What the device can say about the budget right now. "none": it holds no
 * book (Just track, or never pulled). "stale": it holds a book but no block
 * made for that book as it is now, so the figures are unavailable until a pull
 * and its gate catch up. "ready": the figures read.
 */
export type BudgetStatus = "none" | "stale" | "ready";

export function budgetStatus(db: Reader, pass?: FigurePass): BudgetStatus {
	const book = syncedBook(db, pass);
	if (!book) return "none";
	const active = rowsIn(db, pass, "budgetSnapshot")[0];
	if (!active || active.bookId !== book.id || active.valuationKey !== book.key)
		return "stale";
	return "ready";
}
