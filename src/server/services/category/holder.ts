/**
 * What every holder of a category id shares (the list is the domain's,
 * category-merge/holders.ts): the move's context, the one refusal an undo
 * gives when anything changed since, and the compare-and-swap helpers that
 * keep a write exact. A holder's `held` is what its undo needs, ids and
 * stamps only (never names or text), kept in the sealed undo stash.
 */
import type { CATEGORY_HOLDERS } from "@retrospend/domain/category-merge/holders";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";

export type Tx = Prisma.TransactionClient;

export interface MergeCtx {
	readonly tx: Tx;
	readonly userId: string;
	readonly sourceId: string;
	/** Null: the category is deleted and its rows become uncategorized. */
	readonly targetId: string | null;
	/**
	 * The updatedAt a row this mutation writes asks for. The database keeps the
	 * larger of it and the row's old stamp plus a millisecond (stamp_moves), so
	 * what a row stored is read back from the write, never assumed to be this.
	 */
	readonly stamp: Date;
}

export interface Moved<H> {
	readonly held: H;
	readonly moved: number;
	readonly dropped: number;
}

export interface HolderAdapter<H> {
	/**
	 * How many rows of this holder name the source category right now, whoever
	 * wrote them. Nothing is written. A delete would drop or uncategorize each
	 * of them (the foreign keys act on every row), so the undo of a create
	 * counts them all before it deletes anything.
	 */
	count(c: MergeCtx): Promise<number>;
	move(c: MergeCtx): Promise<Moved<H>>;
	/** Puts back what `move` held, or throws `staleUndo` and changes nothing. */
	restore(c: MergeCtx, held: H): Promise<void>;
}

/** Rows the database stored with one stamp. */
export interface StampGroup {
	readonly ids: readonly string[];
	readonly stamp: string;
}

/**
 * Rows a move wrote, with the stamp each stored. The undo writes a row back
 * only while it still has the stamp the move left, so each row's own stamp is
 * kept (rows rarely differ, so most holders hold one group).
 */
export interface Stamped {
	readonly stamps: readonly StampGroup[];
}

/** A row as `updateManyAndReturn` answers it with `{ id, updatedAt }` selected. */
export interface StampedRow {
	readonly id: string;
	readonly updatedAt: Date;
}

/** The rows grouped by the stamp they stored, in the order they first appear. */
export function groupByStamp(rows: readonly StampedRow[]): Stamped {
	const groups = new Map<string, string[]>();
	for (const r of rows) {
		const stamp = r.updatedAt.toISOString();
		groups.set(stamp, [...(groups.get(stamp) ?? []), r.id]);
	}
	return {
		stamps: [...groups].map(([stamp, ids]) => ({ ids, stamp })),
	};
}

/** How many rows a `Stamped` holds. */
export const heldCount = (held: Stamped) =>
	held.stamps.reduce((n, g) => n + g.ids.length, 0);

export const staleUndo = () =>
	new TRPCError({
		code: "CONFLICT",
		message: "This changed since. Undo is no longer safe.",
	});

/** A holder with a foreign key to Category: the ids the database's count function knows. */
export type ForeignKeyHolderId = (typeof CATEGORY_HOLDERS)[number]["id"];

/**
 * Every row of a foreign-key holder that names the source category, rows the
 * caller cannot read included. The delete's foreign keys act on all of them, so
 * a count through the caller's client (row level security hides a shared
 * expense of a project the caller left) would be short. The database function
 * (20261127400000_category_holder_count) answers only for a category the
 * caller owns and a holder it knows; anything else is null, and null is
 * refused here as stale, never read as zero.
 */
export async function countForeignKeyRows(
	c: MergeCtx,
	holder: ForeignKeyHolderId,
): Promise<number> {
	const [row] = await c.tx.$queryRaw<{ n: bigint | null }[]>`
		SELECT category_holder_count(${c.sourceId}, ${holder}) AS "n"`;
	if (row?.n === null || row?.n === undefined) throw staleUndo();
	return Number(row.n);
}

/** Keeps a parameter list well under the database's limit. */
const CHUNK = 5000;

function* chunksOf<T>(items: readonly T[]): Generator<T[]> {
	for (let i = 0; i < items.length; i += CHUNK) yield items.slice(i, i + CHUNK);
}

/**
 * Writes `ids` in chunks and holds the rows the write returned with the stamp
 * each stored (a row another transaction took away in between is not
 * returned, so it is not held).
 */
export async function stampedMove(
	ids: readonly string[],
	write: (chunk: string[]) => Promise<StampedRow[]>,
): Promise<Stamped> {
	const out: StampedRow[] = [];
	for (const chunk of chunksOf(ids)) out.push(...(await write(chunk)));
	return groupByStamp(out);
}

/**
 * The compare-and-swap of an undo: every id must still match the filter the
 * write carries (the row as the move left it) or nothing is written. The
 * write is one UPDATE per chunk, so a concurrent edit either lands before it
 * (the count is short and the undo is refused) or waits for it.
 */
export async function swapAll(
	ids: readonly string[],
	write: (chunk: string[]) => Promise<{ count: number }>,
): Promise<void> {
	let done = 0;
	for (const chunk of chunksOf(ids)) done += (await write(chunk)).count;
	if (done !== ids.length) throw staleUndo();
}

/**
 * The undo of a stamped move: each group is swapped back only while its rows
 * still have the stamp the move left (`swapAll` refuses if any does not).
 */
export async function swapStamped(
	held: Stamped,
	write: (chunk: string[], stamp: Date) => Promise<{ count: number }>,
): Promise<void> {
	for (const group of held.stamps)
		await swapAll(group.ids, (chunk) => write(chunk, new Date(group.stamp)));
}

/** `held` of a holder with nothing to put back. */
export const nothing = { stamps: [] } satisfies Stamped;
