/**
 * Bulk categorize and bulk delete of a person's expenses, once, for the
 * server and the device. The rules are one set: which rows a bulk action
 * reaches (the entry policy: your own outgoing rows, not a spread part), which
 * it skips and why, and the category rule (the same owner an edit uses, with
 * categorize's lenient mode for an undo).
 *
 * What a bulk action skips, with the reason it reports:
 * - notFound: not the person's, gone, an income row or a spread part (the
 *   entry policy hides it, as it does from an edit).
 * - hasLegs: a transfer's fee. A delete would orphan its transfer; a
 *   categorize is skipped the same way, so the two agree on which rows count.
 * - spread (categorize only): a spread parent. Its parts hold their own
 *   category, and an edit syncs them; a bulk move would leave them behind.
 *   A delete takes the parent and its parts together.
 *
 * Categorize applies the category's default the way an edit does: a row moved
 * into a category held out of analytics by default is marked excluded; a row
 * already in the category, and a move to a category with no default, leave the
 * flag alone. An undo names the flag to put back (`excluded`), so it restores
 * exactly what the move changed.
 */
import { type CategoryFacts, expenseCategory } from "./category";
import type { ExpenseEditPort, StoredExpense } from "./edit";
import { checkDeletable, ENTRY_POLICY, reach } from "./policy";
import { CategoryNotFoundError, EditRefusal } from "./refusals";

export const NOTHING_TO_DELETE = "None of these expenses can be deleted here.";

export type BulkSkipReason = "notFound" | "hasLegs" | "spread";

export interface BulkSkip {
	id: string;
	reason: BulkSkipReason;
}

/** What a bulk action reads and writes; the server's Prisma adapter and the device's store adapter implement it. */
export interface ExpenseBulkPort extends Pick<ExpenseEditPort, "remove"> {
	/** The person's rows among these ids (one read), whatever their kind. */
	rows(ids: readonly string[]): Promise<StoredExpense[]>;
	/** The person's category with this id (the owner checks its kind), or null. */
	category(id: string): Promise<CategoryFacts | null>;
	/**
	 * Puts these rows into the category (null: none). `excluded` set writes the
	 * flag too; undefined leaves it.
	 */
	setCategory(
		rows: readonly StoredExpense[],
		categoryId: string | null,
		excluded: boolean | undefined,
	): Promise<void>;
}

/** Why a bulk action leaves this row alone, or null when it takes it. */
export function skipReason(
	row: StoredExpense | undefined,
	action: "delete" | "categorize",
): BulkSkipReason | null {
	if (!row) return "notFound";
	try {
		reach(row, ENTRY_POLICY);
	} catch (e) {
		if (e instanceof EditRefusal) return "notFound";
		throw e;
	}
	try {
		checkDeletable(row, ENTRY_POLICY);
	} catch (e) {
		if (e instanceof EditRefusal) return "hasLegs";
		throw e;
	}
	return action === "categorize" && row.isAmortizedParent ? "spread" : null;
}

/** The rows by id, in the order the ids came, each id once. */
async function readRows(port: ExpenseBulkPort, ids: readonly string[]) {
	const unique = [...new Set(ids)];
	const found = new Map((await port.rows(unique)).map((r) => [r.id, r]));
	return unique.map((id) => ({ id, row: found.get(id) }));
}

export interface DeleteManyHooks {
	/** Runs for each row that will go, before it goes: the server's snapshot and stamp check. */
	beforeRemove?: (row: StoredExpense) => Promise<void>;
}

export interface DeletedMany {
	deleted: string[];
	skipped: BulkSkip[];
}

/**
 * Deletes each reachable row (and, through the adapter, a spread parent's
 * parts) and names the ids it skipped, in the order given. Refuses when
 * nothing can go.
 */
export async function deleteMany(
	port: ExpenseBulkPort,
	ids: readonly string[],
	hooks: DeleteManyHooks = {},
): Promise<DeletedMany> {
	const deleted: string[] = [];
	const skipped: BulkSkip[] = [];
	for (const { id, row } of await readRows(port, ids)) {
		const reason = skipReason(row, "delete");
		if (reason || !row) {
			skipped.push({ id, reason: reason ?? "notFound" });
			continue;
		}
		await hooks.beforeRemove?.(row);
		await port.remove(row);
		deleted.push(id);
	}
	if (deleted.length === 0)
		throw new EditRefusal("badRequest", NOTHING_TO_DELETE);
	return { deleted, skipped };
}

/** Entries (by id) that belong in one category; null is uncategorized. */
export interface CategoryMove {
	readonly categoryId: string | null;
	readonly ids: readonly string[];
	/** An undo: the flag these rows had, put back as it was instead of the category's default. */
	readonly excluded?: boolean;
}

export interface CategorizeOptions {
	/** An undo: a category deleted since leaves its entries uncategorized instead of failing. */
	lenient?: boolean;
}

export interface Categorized {
	/** Rows reached, whether or not they were already in the category. */
	updated: number;
	/** Where the rows were: the moves that put them back. */
	previous: CategoryMove[];
	skipped: BulkSkip[];
}

/** The category of a move: the owner's rule, or null for a gone one when lenient. */
async function targetOf(
	port: ExpenseBulkPort,
	move: CategoryMove,
	lenient: boolean,
): Promise<CategoryFacts | null> {
	if (!move.categoryId) return null;
	try {
		// Categorize is the one route that answers a bad category with 403.
		return expenseCategory(await port.category(move.categoryId), "forbidden");
	} catch (e) {
		if (lenient && e instanceof CategoryNotFoundError) return null;
		throw e;
	}
}

/**
 * Moves each move's reachable rows into its category. The category is checked
 * before any row is read, so a bad category is refused whatever the ids are.
 */
export async function categorize(
	port: ExpenseBulkPort,
	moves: readonly CategoryMove[],
	{ lenient = false }: CategorizeOptions = {},
): Promise<Categorized> {
	const previous = new Map<string, { move: CategoryMove; ids: string[] }>();
	const skipped: BulkSkip[] = [];
	let updated = 0;
	for (const move of moves) {
		const target = await targetOf(port, move, lenient);
		const targetId = target?.id ?? null;
		const taken: StoredExpense[] = [];
		for (const { id, row } of await readRows(port, move.ids)) {
			const reason = skipReason(row, "categorize");
			if (reason || !row) skipped.push({ id, reason: reason ?? "notFound" });
			else taken.push(row);
		}
		for (const row of taken) {
			const key = `${row.categoryId ?? ""}|${row.excludeFromAnalytics}`;
			const was = previous.get(key) ?? {
				move: {
					categoryId: row.categoryId,
					ids: [],
					excluded: row.excludeFromAnalytics,
				},
				ids: [],
			};
			was.ids.push(row.id);
			previous.set(key, was);
		}
		const flag = move.excluded ?? (target?.excludeByDefault ? true : undefined);
		const changing = taken.filter((row) => row.categoryId !== targetId);
		if (changing.length > 0) await port.setCategory(changing, targetId, flag);
		updated += taken.length;
	}
	return {
		updated,
		previous: [...previous.values()].map(({ move, ids }) => ({ ...move, ids })),
		skipped,
	};
}
