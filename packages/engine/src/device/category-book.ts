import { ConflictError } from "../errors";
import {
	CATEGORY_CREATE_MUTATION,
	CATEGORY_UPDATE_MUTATION,
} from "../category-mutations";
import { type CategoryChange, categoryWithoutText } from "../category-rows";
import {
	type CreateCategoryInput,
	createCategory,
	type UpdateCategoryInput,
	updateCategory,
} from "../category-write-local";
import type { RowChange } from "../changes";
import type { CategoryRow } from "../port";
import { ROWS_ADDED_MESSAGE } from "../undo";

// A person's category create or edit, as the device books it: the engine's
// category mutations over the same fields the v1 bodies take, so the device's
// row and the server's meet by the body's client-made id. As with account
// writes the booking checks no version: which version the server holds is
// decided at send (the body's `expectedVersion`, taken from `categoryBase`),
// and a view that has moved on only makes this booking a refusal. A name the
// person already uses is refused here too (the domain's rule over the pulled
// rows and the device's own unsent creates and renames).
//
// The row a category write changes is a `CategoryChange` like any other
// write's: the outbox, the overlay and the compare read it as a
// `PendingChange`, without the category's name (category-rows.ts). The name
// itself rides in the request's payload, and in memory in `PendingEntry.
// categoryNames` so the overlay can show it to the name check.

export type CategoryCreateBody = CreateCategoryInput;
/** An edit's body: the fields it names and, when the caller read one, the version. */
export type CategoryUpdateBody = UpdateCategoryInput;

export type CategoryOp =
	| { kind: "categoryCreate"; body: CategoryCreateBody }
	| { kind: "categoryUpdate"; body: CategoryUpdateBody };

export const isCategoryOp = (op: { kind: string }): op is CategoryOp =>
	op.kind.startsWith("category");

/** The mutation of a category write, the figures it moves (none), and its write. */
export function categoryPlanOf(op: CategoryOp) {
	return op.kind === "categoryCreate"
		? {
				id: CATEGORY_CREATE_MUTATION.id,
				touches: CATEGORY_CREATE_MUTATION.touches,
				write: createCategory(op.body),
			}
		: {
				id: CATEGORY_UPDATE_MUTATION.id,
				touches: CATEGORY_UPDATE_MUTATION.touches,
				write: updateCategory(op.body),
			};
}

/** The field names an edit changes: the ones it names (a name sent is a rename). */
export function namedFieldsOf(op: CategoryOp): string[] {
	if (op.kind === "categoryCreate") return [];
	const { name, color, icon, excludeByDefault } = op.body;
	return Object.entries({ name, color, icon, excludeByDefault }).flatMap(
		([field, value]) => (value === undefined ? [] : [field]),
	);
}

/** The category row `c` changed, without its name; null for another table. */
export function categoryChangeOf(c: RowChange): CategoryChange | null {
	if (c.table !== "categories") return null;
	const bare = (row: unknown) =>
		row === null ? null : categoryWithoutText(row as CategoryRow);
	return {
		table: "categories",
		id: c.id,
		before: bare(c.before),
		after: bare(c.after),
	};
}

/**
 * What an entry holds that the checks below read: the engine's `PendingEntry`
 * (so `refuseCategoryUncreate(engine.pending.entries(), id)` is what a caller
 * writes). `entity`, `targetId` and `payload` are required: an entry the
 * device could not book (no rate) or that a booking refused has no `changes`,
 * and only its payload names its category. A caller that has none to give
 * cannot compile.
 */
export interface CategoryHolderEntry {
	readonly clientId: string;
	/** The server's entity name ("categories", "expenses", "recurring"). */
	readonly entity: string;
	/** The row the write is about: the expense, the template or the category. */
	readonly targetId: string;
	/** The request the entry sends. */
	readonly payload: unknown;
	readonly ack?: unknown;
	readonly unbooked?: unknown;
	readonly changes: readonly {
		readonly table: string;
		readonly id: string;
		readonly after: unknown;
	}[];
}

/**
 * The client ids of the entries a write that names `categoryId` must wait for:
 * every entry the server has not accepted yet (open or parked) whose booking
 * created or edited that category. The write chains on them and parks with
 * them (name taken, id taken, a changed category), so the server never meets
 * an expense, a template or a bulk move for a category it has not got, or got
 * with a different count default. Oldest first.
 */
export function chainOnCategory(
	entries: readonly CategoryHolderEntry[],
	categoryId: string,
): string[] {
	return entries
		.filter(
			(e) =>
				e.ack === undefined &&
				(e.changes.some(
					(c) => c.table === "categories" && c.id === categoryId,
				) ||
					(e.entity === "categories" && e.targetId === categoryId)),
		)
		.map((e) => e.clientId);
}

/** A field of an entry's payload, or undefined. */
function payloadField(e: CategoryHolderEntry, field: string): unknown {
	const p = e.payload;
	return typeof p === "object" && p !== null
		? (p as Record<string, unknown>)[field]
		: undefined;
}

/**
 * The rows that name `categoryId` in the entries, whatever state the entry is
 * in (open, parked, or accepted and not pulled back yet): an expense or a
 * template an entry wrote into it, read from its booked rows AND from its
 * payload, so an entry the device could not book (no rate) or that a booking
 * refused still counts. The category's create cannot be taken back while any
 * is left, before or after it was sent: sent, the server's undo would succeed
 * over the entry that is still on its way and leave the dependent without a
 * category. A payload row is the entry's target.
 */
export function entryRowsNamingCategory(
	entries: readonly CategoryHolderEntry[],
	categoryId: string,
): { table: "expenses" | "recurringTemplates"; id: string }[] {
	return entries.flatMap((e) => {
		const booked = e.changes.flatMap((c) =>
			(c.table === "expenses" || c.table === "recurringTemplates") &&
			(c.after as { categoryId?: string | null } | null)?.categoryId ===
				categoryId
				? [{ table: c.table as "expenses" | "recurringTemplates", id: c.id }]
				: [],
		);
		if (booked.length > 0 || payloadField(e, "categoryId") !== categoryId)
			return booked;
		return [
			{
				table:
					e.entity === "recurring"
						? ("recurringTemplates" as const)
						: ("expenses" as const),
				id: e.targetId,
			},
		];
	});
}

/**
 * Refuses taking back the creation of `categoryId` while a write the device
 * holds names it. Throws the ConflictError an undo with rows added since
 * throws; nothing is written either way.
 */
export function refuseCategoryUncreate(
	entries: readonly CategoryHolderEntry[],
	categoryId: string,
): void {
	const rows = entryRowsNamingCategory(entries, categoryId);
	if (rows.length > 0) throw new ConflictError(ROWS_ADDED_MESSAGE, rows);
}
