/**
 * What every envelope edit shares (create, update, combine, archive): the
 * category links an edit moves, the movement rows that keep each envelope's
 * Left where it was when spending is rerouted, and the before and after
 * lines a preview lists (RC-5). Runs on the caller's transaction.
 */
import { randomUUID } from "node:crypto";
import type { MovementResult } from "~/lib/schemas/envelope";
import type { RoutedCategory } from "~/lib/schemas/envelope-crud";
import type { Prisma } from "~prisma";
import { settleDeltas } from "./crud-math";
import { EnvelopeError } from "./errors";
import { ensureMonthsClosed } from "./month-close.service";
import { forgetMonthViews } from "./month-read";
import { insert, result } from "./movement.service";
import {
	lockedSnapshot,
	type NewMovement,
	type Snapshot,
	snapshot,
} from "./movement-state";
import type { MonthKey } from "./types";

type Tx = Prisma.TransactionClient;

export type LeftChange = MovementResult["envelopes"][number];

/**
 * Starts an edit that moves category links: finished months close first (so
 * they close with the routing they had, B7), then the book is locked and read.
 */
export async function begin(tx: Tx, userId: string, now: Date) {
	await ensureMonthsClosed(tx, userId, now);
	return lockedSnapshot(tx, userId, now);
}

/** The envelope's Left in `month`, as a Money line before and after. */
export function leftChanges(
	before: Snapshot,
	after: Snapshot,
	ids: readonly string[],
	month: MonthKey,
): LeftChange[] {
	const currency = after.loaded.book.currency;
	return [...new Set(ids)].map((id) => ({
		id,
		before: { minor: before.left(id, month), currency },
		after: { minor: after.left(id, month), currency },
	}));
}

/** Every category must be one of the person's own expense categories (RLS shows only theirs). */
export async function checkCategories(tx: Tx, categoryIds: readonly string[]) {
	const unique = new Set(categoryIds);
	if (unique.size !== categoryIds.length)
		throw new EnvelopeError("INVALID", "a category appears once");
	const own = await tx.category.count({
		where: { id: { in: [...unique] }, kind: "EXPENSE" },
	});
	if (own !== unique.size)
		throw new EnvelopeError("INVALID", "unknown or income category");
}

/**
 * Points each category at the envelope in `to` (null: at none, so it falls to
 * Everything else). Returns what actually moved; a category already there is
 * left alone. A category lives in one envelope, so it leaves the one it was in.
 */
export async function moveLinks(
	tx: Tx,
	s: Snapshot,
	to: ReadonlyMap<string, string | null>,
): Promise<RoutedCategory[]> {
	const bookId = s.loaded.row.id;
	const owner = new Map<string, string>();
	for (const e of s.loaded.row.envelopes)
		for (const c of e.categories) owner.set(c.categoryId, e.id);
	const moved: RoutedCategory[] = [];
	for (const [categoryId, dest] of to) {
		const from = owner.get(categoryId) ?? null;
		if (from === dest) continue;
		if (dest === null)
			await tx.envelopeCategory.deleteMany({ where: { bookId, categoryId } });
		else if (from === null)
			await tx.envelopeCategory.create({
				data: { bookId, envelopeId: dest, categoryId },
			});
		else
			await tx.envelopeCategory.updateMany({
				where: { bookId, categoryId },
				data: { envelopeId: dest },
			});
		moved.push({ categoryId, from, to: dest });
	}
	forgetMonthViews(tx);
	return moved;
}

/** Puts links back as they were (an undo): `from` is the envelope that had the category. */
export async function restoreLinks(
	tx: Tx,
	bookId: string,
	links: readonly RoutedCategory[],
) {
	for (const l of links) {
		if (l.from === null)
			await tx.envelopeCategory.deleteMany({
				where: { bookId, categoryId: l.categoryId },
			});
		else {
			const exists = await tx.envelopeCategory.updateMany({
				where: { bookId, categoryId: l.categoryId },
				data: { envelopeId: l.from },
			});
			if (exists.count === 0)
				await tx.envelopeCategory.create({
					data: { bookId, envelopeId: l.from, categoryId: l.categoryId },
				});
		}
	}
	forgetMonthViews(tx);
}

/**
 * Rerouted spending changes Left; these rows pay it back between the
 * envelopes involved so no envelope's Left changes: the spending moves with
 * the money that paid for it. `before` is read before the links moved,
 * `after` is read once they have. Only the current month is touched.
 */
export function neutralRows(
	before: Snapshot,
	after: Snapshot,
	batchId: string,
	kind: NewMovement["kind"],
): NewMovement[] {
	const c = after.current;
	const deltas = after.loaded.book.envelopes.map((e) => ({
		id: e.id,
		delta: after.left(e.id, c) - before.left(e.id, c),
	}));
	return settleDeltas(deltas).map((r) => ({
		id: randomUUID(),
		month: c,
		from: r.from,
		to: r.to,
		minor: r.minor,
		kind,
		batchId,
	}));
}

/**
 * Writes the rows and reads back what they did, listing every envelope the
 * edit touched with its Left before and after, not only the ones with rows.
 */
export async function writeAndList(
	tx: Tx,
	p: {
		userId: string;
		now: Date;
		before: Snapshot;
		rows: NewMovement[];
		touched: readonly string[];
	},
) {
	await insert(tx, p.before, p.userId, p.rows);
	forgetMonthViews(tx);
	const moved = await result(
		tx,
		p.userId,
		p.now,
		p.before,
		p.rows.map((r) => r.id),
	);
	const after = await snapshot(tx, p.userId, p.now);
	return {
		moved,
		after,
		left: leftChanges(p.before, after, p.touched, p.before.current),
	};
}
