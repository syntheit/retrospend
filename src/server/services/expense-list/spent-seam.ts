/**
 * The seam to `spent(filter)`, the one spending definition (IMPLEMENTATION
 * §1.4). It lives on segment/money-engine
 * (src/server/services/figures/spent.ts: spentItems, spentIn) and is not on
 * this branch's base yet, so the Activity footer has no total until it
 * merges (docs/ui/GAPS.md §7). It never falls back to a sum of its own: two
 * definitions of "your spending" is the bug this figure exists to remove.
 *
 * At the merge, `activitySpent` becomes:
 *   const v = await spentIn(db, { userId, date: { gte, lte } , categoryIds }, home, homeRate);
 *   return { figure: "spent", value: { minor: toMinor(v, home), currency: home } };
 * (lte is the end of the `to` day; spentIn takes inclusive bounds.)
 */
import type { Prisma } from "~prisma";
import type { ListBounds } from "./query";
import type { ActivityTotalDTO, ListV2Filter } from "./types";

/** What spent() can express: dates and categories. */
export type SpentSeamFilter = {
	userId: string;
	bounds: ListBounds;
	categoryIds?: readonly string[];
};

/**
 * The spent() filter for an Activity filter, or null when the list shows
 * something spent() does not count or cannot narrow to (people, projects,
 * payer, a type, search text), as in the mockup's display audit.
 */
export function spentFilterOf(
	userId: string,
	filter: ListV2Filter,
	bounds: ListBounds,
): SpentSeamFilter | null {
	const narrowed =
		!!filter.people?.length ||
		!!filter.projectIds?.length ||
		!!filter.paidBy?.length ||
		!!filter.kinds?.length ||
		!!filter.q?.trim();
	if (narrowed) return null;
	return {
		userId,
		bounds,
		...(filter.categoryIds?.length ? { categoryIds: filter.categoryIds } : {}),
	};
}

/** Your spending for the footer; null until spent() is on this branch. */
export async function activitySpent(
	_db: Prisma.TransactionClient,
	_filter: SpentSeamFilter,
	_home: string,
): Promise<ActivityTotalDTO | null> {
	return null;
}
