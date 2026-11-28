/**
 * The one rule for "a category reference is the actor's own". Row level
 * security is no stand-in: a person on a split can read the owner's category
 * (K7, category_shared_read), and a foreign key accepts any id that exists, so
 * every write that names a category asks here, with the actor's id in the query.
 *
 * `ownCategoryWhere` is the filter for any lookup by id (a site keeps its own
 * select). `assertSharedRowCategory` is the rule for the category on a shared
 * expense (create, edit, correction); it refuses with CategoryNotFoundError,
 * which says nothing about whether the id exists (tRPC FORBIDDEN, v1 404
 * not_found). Where a category may be shown is a separate rule, written once
 * in SQL (category_shown_on_split) and read through category-shown.ts.
 *
 * The domain's `expenseCategory` is a different rule (an expense category's
 * kind, from a row already looked up) and stays pure.
 */
import { CategoryNotFoundError } from "@retrospend/domain/expense-write/refusals";
import type { CategoryKind, Prisma } from "~prisma";
import { type ParticipantRef, sameParticipant } from "../shared-expenses/types";

type Db = Pick<Prisma.TransactionClient, "category">;

/** The filter for the actor's own category (or categories) by id. */
export function ownCategoryWhere(
	userId: string,
	id: string | readonly string[],
	kind?: CategoryKind,
): Prisma.CategoryWhereInput {
	return {
		id: typeof id === "string" ? id : { in: [...id] },
		userId,
		...(kind ? { kind } : {}),
	};
}

export async function isOwnCategory(
	db: Db,
	userId: string,
	id: string,
	kind?: CategoryKind,
): Promise<boolean> {
	return (await db.category.count({ where: ownCategoryWhere(userId, id, kind) })) > 0;
}

export interface SharedRowCategoryContext {
	/** The row's category now (an update), so a request that keeps it passes. */
	readonly unchangedFrom?: string | null;
	/**
	 * The id comes from a record the server wrote and signed (the v1 undo token
	 * of an edit), not from the client. Only that path sets it; a transport
	 * schema never carries it.
	 */
	readonly restoredFromServerRecord?: boolean;
	/**
	 * The writer created the split or is a person on it (after this write). The
	 * write rule is the read rule (category_shown_on_split): an owner's category
	 * is shown only on a split they created or are on, so anyone else setting
	 * theirs would set a category no one can see.
	 */
	readonly writerOnSplit: boolean;
}

/**
 * The category on a shared expense: none, the one it already has, one from a
 * server-held record, or the writer's own on a split they created or are on. A
 * guest or shadow has no categories, so for them only none or the unchanged
 * one. Fails closed: anything else, or a lookup that finds nothing, is refused.
 */
export async function assertSharedRowCategory(
	db: Db,
	actor: { participantType: "user" | "guest" | "shadow"; participantId: string },
	categoryId: string | null | undefined,
	context: SharedRowCategoryContext,
): Promise<void> {
	if (categoryId == null) return;
	if (categoryId === context.unchangedFrom) return;
	if (context.restoredFromServerRecord === true) return;
	if (
		!context.writerOnSplit ||
		actor.participantType !== "user" ||
		!(await isOwnCategory(db, actor.participantId, categoryId))
	)
		throw new CategoryNotFoundError("not_found");
}

/**
 * Whether the writer created the split or is a person on it once this edit is
 * written: `peopleAfter` is who the split will have (an edit that names the
 * people replaces them; one that does not keeps them). The `writerOnSplit` of
 * an update.
 */
export function writerOnSplit(
	actor: ParticipantRef,
	existing: { createdByType: string; createdById: string },
	peopleAfter: readonly ParticipantRef[],
): boolean {
	return (
		(existing.createdByType === actor.participantType &&
			existing.createdById === actor.participantId) ||
		peopleAfter.some((p) => sameParticipant(p, actor))
	);
}
