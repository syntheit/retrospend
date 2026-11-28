/**
 * A category's name for an audit line (category-shown.ts). The log reads as the
 * owner, with no row level security, so the name goes out only to the
 * category's owner (even on a split that is gone) and to anyone it may be
 * shown to on that split. Anyone else gets an empty name, never the id: the same
 * neutral form a sealed name takes when the log cannot open it, so there is one
 * neutral form and no extra copy to translate. With sealing on the owner's own
 * name is empty too, since the log reads without the person's key. A category
 * that no longer exists is null, and the formatter then keeps showing the stored
 * id as it always did. Split out of audit-log-formatter.ts to keep that file
 * small.
 */
import { shownCategoryPairs } from "~/server/services/category/category-shown";
import type { PrismaClient } from "~prisma";

export const HIDDEN_CATEGORY = "";

// Null sentinel stored in cache so we don't re-query deleted categories
const NULL_SENTINEL = "\x00";
const VIEWER_KEY = "viewer:user";

/** The per-request cache of names; `viewerUserId` is who reads the log (none for a guest or link). */
export function nameCacheFor(viewerUserId?: string): Map<string, string> {
	return new Map(viewerUserId ? [[VIEWER_KEY, viewerUserId]] : []);
}

export async function resolveCategoryName(
	db: PrismaClient,
	splitId: string,
	categoryId: string | null | undefined,
	cache: Map<string, string>,
): Promise<string | null> {
	if (!categoryId) return null;

	const key = `category:${splitId}:${categoryId}`;
	const hit = cache.get(key);
	if (hit !== undefined) return hit === NULL_SENTINEL ? null : hit;

	try {
		const row = await db.category.findUnique({
			where: { id: categoryId },
			select: { name: true, userId: true },
		});
		const shown =
			!!row &&
			(row.userId === cache.get(VIEWER_KEY) ||
				(await shownCategoryPairs([{ splitId, categoryId }]))(
					splitId,
					categoryId,
				));
		const name = row ? (shown ? row.name : HIDDEN_CATEGORY) : null;
		cache.set(key, name ?? NULL_SENTINEL);
		return name;
	} catch {
		cache.set(key, NULL_SENTINEL);
		return null;
	}
}
