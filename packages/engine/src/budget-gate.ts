/**
 * When a device may read the budget figures. The budget block
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
 * Where a set of cursors stands against one sync position (a block's or a
 * server read's `asOf`). "reached": every entity has the position's epoch and
 * is at or past it. "reset": an entity is being pulled again. "behind": an
 * entity has no cursor, one of another epoch, or one below the position.
 * "malformed": the position is not a cursor. Positions are cluster-wide, so
 * "at or past" says nothing about whose rows moved it.
 */
export type PositionState = "reached" | "reset" | "behind" | "malformed";

/** The one rule for "the device has caught up to this position", for the budget gate and the compare. */
export function positionReached(
	cursors: Readonly<Partial<Record<string, string>>>,
	entities: readonly string[],
	asOf: string,
): PositionState {
	const at = cursorPosition(asOf);
	if (!at) return "malformed";
	let waiting = false;
	for (const entity of entities) {
		const cursor = cursors[entity];
		if (cursor === SYNC_RESET) return "reset";
		const position = cursor === undefined ? null : cursorPosition(cursor);
		if (!position || position.epoch !== at.epoch || !atLeast(position.t, at.t))
			waiting = true;
	}
	return waiting ? "behind" : "reached";
}

/**
 * Whether `cursor` lies strictly past `position`: every stamp a page ending at
 * it holds is at or below its position, so a page whose cursor is not past
 * `position` holds nothing newer than `position`. Another epoch or an unreadable cursor counts
 * as past (fail closed).
 */
export function pastPosition(cursor: string, position: string): boolean {
	const at = cursorPosition(position);
	const held = cursorPosition(cursor);
	if (!at || !held || held.epoch !== at.epoch) return true;
	return !atLeast(at.t, held.t);
}

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
	const state = positionReached(
		p.cursors,
		BUDGET_GATE_ENTITIES,
		p.pending.asOf,
	);
	if (state === "malformed") return { passes: false, reason: "malformed" };
	if (state === "reset") return { passes: false, reason: "reset" };
	if (state === "behind") return { passes: false, reason: "cursors" };
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
 * made for rows the device no longer holds, so it goes, and the reset flag is
 * set. The figures read unavailable until the re-pull ends and the pending
 * block passes its gate (which clears the flag). The flag, not the snapshot,
 * is what keeps `budgetStatus` at "stale" when the entity is the book itself:
 * its rows go with the reset, and without the flag the device would look like
 * a person with no budget. The pending block stays. False when the entity is
 * not one the budget reads.
 */
export function dropBudgetOnReset(tx: Writer, entity: string): boolean {
	if (!(BUDGET_GATE_ENTITIES as readonly string[]).includes(entity))
		return false;
	tx.delete("budgetSnapshot", BUDGET_SNAPSHOT_ID);
	tx.put("budgetReset", { id: BUDGET_SNAPSHOT_ID, entity });
	return true;
}

/**
 * What the device can say about the budget right now. "none": it holds no
 * book (Just track, or never pulled). "stale": it holds a book but no block
 * made for that book as it is now, so the figures are unavailable until a pull
 * and its gate catch up, or a 410 left the reset flag (the book's own rows may
 * be gone then). "ready": the figures read.
 */
export type BudgetStatus = "none" | "stale" | "ready";

export function budgetStatus(db: Reader, pass?: FigurePass): BudgetStatus {
	if (rowsIn(db, pass, "budgetReset").length > 0) return "stale";
	const book = syncedBook(db, pass);
	if (!book) return "none";
	const active = rowsIn(db, pass, "budgetSnapshot")[0];
	if (!active || active.bookId !== book.id || active.valuationKey !== book.key)
		return "stale";
	return "ready";
}
