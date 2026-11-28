/**
 * The reader side of "where may a category be shown": a category may appear on
 * a split its owner created or is a person on. The rule is one SQL function,
 * category_shown_on_split (migration 20261127300000), which the category
 * policy's K7 function and the public page's totals call too. Readers that
 * run as the owner (guests, viewer links, the public page, the audit log) get
 * no row level security, so every category they show passes through here. A
 * pair the function does not confirm, a split that is gone or a lookup that
 * fails is hidden: fail closed.
 */
import { db as globalDb } from "~/server/db";
import { Prisma } from "~prisma";

export type CategoryOnSplit = (
	splitId: string,
	categoryId: string | null | undefined,
) => boolean;

const keyOf = (splitId: string, categoryId: string) =>
	JSON.stringify([splitId, categoryId]);

/** Which (split, category) pairs may be shown, asked of the SQL function once. */
export async function shownCategoryPairs(
	pairs: readonly { splitId: string; categoryId: string | null | undefined }[],
): Promise<CategoryOnSplit> {
	const wanted = new Map<string, [string, string]>();
	for (const p of pairs)
		if (p.categoryId)
			wanted.set(keyOf(p.splitId, p.categoryId), [p.splitId, p.categoryId]);
	if (wanted.size === 0) return () => false;
	const rows = await globalDb.$queryRaw<
		{ splitId: string; categoryId: string }[]
	>(Prisma.sql`
		SELECT p."split_id" AS "splitId", p."category_id" AS "categoryId"
		FROM unnest(
			${[...wanted.values()].map((w) => w[0])}::text[],
			${[...wanted.values()].map((w) => w[1])}::text[]
		) AS p("split_id", "category_id")
		WHERE category_shown_on_split(p."category_id", p."split_id")`);
	const shown = new Set(rows.map((r) => keyOf(r.splitId, r.categoryId)));
	return (splitId, categoryId) =>
		!!categoryId && shown.has(keyOf(splitId, categoryId));
}

/** Rows of splits with a `category` relation, with the category dropped where it may not be shown. */
export async function withShownCategory<
	T extends { id: string; category: { id: string } | null },
>(rows: readonly T[]): Promise<T[]> {
	const shown = await shownCategoryPairs(
		rows.map((r) => ({ splitId: r.id, categoryId: r.category?.id })),
	);
	return rows.map((r) =>
		r.category && !shown(r.id, r.category.id) ? { ...r, category: null } : r,
	);
}

/**
 * Rows that hold a split under `key` (a share and its transaction): the split's
 * category dropped where it may not be shown. Only for a guest or shadow actor:
 * a user's client has row level security, which applies the same rule.
 */
export async function withShownCategoryOn<
	K extends string,
	R extends Record<K, { id: string; category: { id: string } | null }>,
>(rows: readonly R[], key: K, actor: { participantType: string }): Promise<R[]> {
	if (actor.participantType === "user") return [...rows];
	const splits = await withShownCategory(rows.map((r) => r[key]));
	return rows.map((r, i) => ({ ...r, [key]: splits[i] }));
}

/** One split's category, or null where it may not be shown (a guest or shadow actor; see withShownCategoryOn). */
export async function shownCategoryOf<
	R extends { id: string; category: { id: string } | null },
>(row: R, actor: { participantType: string }): Promise<R["category"]> {
	const [one] = await withShownCategoryOn([{ row }], "row", actor);
	return one?.row.category ?? null;
}

/** A parent with its splits under `key` (a billing period's expenses): their categories checked as in withShownCategoryOn. */
export async function withShownCategoryList<
	K extends string,
	P extends Record<K, { id: string; category: { id: string } | null }[]>,
>(parent: P, key: K, actor: { participantType: string }): Promise<P> {
	if (actor.participantType === "user") return parent;
	return { ...parent, [key]: await withShownCategory(parent[key]) };
}
