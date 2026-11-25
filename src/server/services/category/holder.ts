/**
 * What every holder of a category id shares (the list is the domain's,
 * category-merge/holders.ts): the move's context, the one refusal an undo
 * gives when anything changed since, and the compare-and-swap helpers that
 * keep a write exact. A holder's `held` is what its undo needs, ids and
 * stamps only (never names or text), kept in the sealed undo stash.
 */
import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";

export type Tx = Prisma.TransactionClient;

export interface MergeCtx {
	readonly tx: Tx;
	readonly userId: string;
	readonly sourceId: string;
	/** Null: the category is deleted and its rows become uncategorized. */
	readonly targetId: string | null;
	/** The updatedAt every row this mutation writes gets, so the undo can tell its own rows. */
	readonly stamp: Date;
}

export interface Moved<H> {
	readonly held: H;
	readonly moved: number;
	readonly dropped: number;
}

export interface HolderAdapter<H> {
	move(c: MergeCtx): Promise<Moved<H>>;
	/** Puts back what `move` held, or throws `staleUndo` and changes nothing. */
	restore(c: MergeCtx, held: H): Promise<void>;
}

/** Rows moved by one stamp. */
export interface Stamped {
	readonly ids: readonly string[];
	readonly stamp: string;
}

export const staleUndo = () =>
	new TRPCError({
		code: "CONFLICT",
		message: "This changed since. Undo is no longer safe.",
	});

/** Keeps a parameter list well under the database's limit. */
const CHUNK = 5000;

function* chunksOf<T>(items: readonly T[]): Generator<T[]> {
	for (let i = 0; i < items.length; i += CHUNK) yield items.slice(i, i + CHUNK);
}

/**
 * Writes `ids` in chunks and returns the ones that now carry the move's stamp
 * (a row another transaction took away in between is not held).
 */
export async function stampedMove(
	ids: readonly string[],
	write: (chunk: string[]) => Promise<unknown>,
	stamped: (chunk: string[]) => Promise<string[]>,
): Promise<string[]> {
	const out: string[] = [];
	for (const chunk of chunksOf(ids)) {
		await write(chunk);
		out.push(...(await stamped(chunk)));
	}
	return out;
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

/** `held` of a holder with nothing to put back. */
export const nothing = { ids: [], stamp: "" } satisfies Stamped;
