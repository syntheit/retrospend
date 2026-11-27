/**
 * The one rule for "a category reference is the actor's own". Row level
 * security is no stand-in: a person on a split can read the owner's category
 * (K7, category_shared_read), and a foreign key accepts any id that exists, so
 * every write that names a category asks here, with the actor's id in the query.
 *
 * `ownCategoryWhere` is the filter for any lookup by id (a site keeps its own
 * select). `assertOwnCategory(ies)` refuses with CategoryNotFoundError, which
 * says nothing about whether the id exists; tRPC maps it to FORBIDDEN and v1 to
 * the code the call site passes. `assertSharedRowCategory` is the rule for the
 * category on a shared expense (create, edit, correction).
 *
 * The domain's `expenseCategory` is a different rule (an expense category's
 * kind, from a row already looked up) and stays pure.
 */
import {
	CategoryNotFoundError,
	type CategoryRefusalCode,
} from "@retrospend/domain/expense-write/refusals";
import type { CategoryKind, Prisma } from "~prisma";

type Db = Pick<Prisma.TransactionClient, "category">;

export interface OwnOptions {
	/** Only categories of this kind; unset means any kind. */
	readonly kind?: CategoryKind;
	/** The v1 answer when refused: write routes say not_found, categorize says forbidden. */
	readonly v1Code?: CategoryRefusalCode;
}

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

export async function assertOwnCategory(
	db: Db,
	userId: string,
	id: string,
	options: OwnOptions = {},
): Promise<void> {
	if (!(await isOwnCategory(db, userId, id, options.kind)))
		throw new CategoryNotFoundError(options.v1Code ?? "not_found");
}

/** Every id is the actor's own (a repeated id counts once). */
export async function assertOwnCategories(
	db: Db,
	userId: string,
	ids: readonly string[],
	options: OwnOptions = {},
): Promise<void> {
	const wanted = [...new Set(ids)];
	if (wanted.length === 0) return;
	const found = await db.category.count({
		where: ownCategoryWhere(userId, wanted, options.kind),
	});
	if (found !== wanted.length)
		throw new CategoryNotFoundError(options.v1Code ?? "not_found");
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
}

/**
 * The category on a shared expense: none, the one it already has, one from a
 * server-held record, or the actor's own. A guest or shadow has no categories,
 * so for them only none or the unchanged one. Fails closed: anything else, or a
 * lookup that finds nothing, is refused.
 */
export async function assertSharedRowCategory(
	db: Db,
	actor: { participantType: "user" | "guest" | "shadow"; participantId: string },
	categoryId: string | null | undefined,
	context: SharedRowCategoryContext = {},
): Promise<void> {
	if (categoryId == null) return;
	if (categoryId === context.unchangedFrom) return;
	if (context.restoredFromServerRecord === true) return;
	if (
		actor.participantType !== "user" ||
		!(await isOwnCategory(db, actor.participantId, categoryId))
	)
		throw new CategoryNotFoundError("not_found");
}
