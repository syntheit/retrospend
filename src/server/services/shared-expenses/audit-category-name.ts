/**
 * A category's name for an audit line, only where it may be shown on that split
 * (category-shown.ts): the log reads as the owner, with no row level security.
 * Split out of audit-log-formatter.ts to keep that file small.
 */
import { shownCategoryPairs } from "~/server/services/category/category-shown";
import type { PrismaClient } from "~prisma";

// Null sentinel stored in cache so we don't re-query deleted categories
const NULL_SENTINEL = "\x00";

export async function resolveCategoryName(
	db: PrismaClient,
	splitId: string,
	categoryId: string | null | undefined,
	cache: Map<string, string>,
): Promise<string | null> {
	if (!categoryId) return null;

	// A category's name goes to the audit log only where it may be shown on
	// that split (category-shown.ts); the log reads as the owner, with no RLS.
	const key = `category:${splitId}:${categoryId}`;
	const hit = cache.get(key);
	if (hit !== undefined) return hit === NULL_SENTINEL ? null : hit;

	try {
		const shown = await shownCategoryPairs([{ splitId, categoryId }]);
		const c = shown(splitId, categoryId)
			? await db.category.findUnique({
					where: { id: categoryId },
					select: { name: true },
				})
			: null;
		const name = c?.name ?? null;
		cache.set(key, name ?? NULL_SENTINEL);
		return name;
	} catch {
		cache.set(key, NULL_SENTINEL);
		return null;
	}
}
