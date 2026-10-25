/**
 * Your share of someone else's split takes your own category (D19, SPEC
 * §5.8). The creator's category is theirs and never counts in your budget.
 *
 * - A category you picked (source USER) always wins.
 * - Otherwise the smart default, first match wins:
 *   1. NAME_MATCH: you have a category with the creator's category's name.
 *   2. PROJECT: the category you last picked for a share in the same project.
 *   3. PERSON: the category you last picked for a share someone paid.
 *   The server never reads the split's title to guess (E2EE rule 2): a
 *   suggestion from the title is the client's, from its own data.
 * - With none, the share is unresolved: it lands in "Everything else" and
 *   raises one Needs you item (UNCATEGORIZED_SHARES).
 *
 * Only shares you picked feed PROJECT and PERSON, so one guess never seeds
 * another. Pure: the loader passes the rows; share-category.service.ts
 * stores what this decides so the choice stays put.
 */
import type { IsoDate } from "./types";

export type ShareCategorySource =
	| "USER"
	| "NAME_MATCH"
	| "PROJECT"
	| "PERSON"
	| "TITLE";

export interface ShareForCategory {
	id: string;
	/** The participant's own category, when set. */
	categoryId: string | null;
	categorySource: ShareCategorySource | null;
	date: IsoDate;
	projectId: string | null;
	/** Canonical key of who paid. */
	payer: string;
	/** The creator's category name when you may read it, and whose it is. */
	creatorCategory: { id: string; name: string; isMine: boolean } | null;
}

export interface MyCategory {
	id: string;
	name: string;
}

export interface ShareCategoryChoice {
	categoryId: string | null;
	source: ShareCategorySource | null;
}

const norm = (s: string) =>
	s
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.trim()
		.toLowerCase();

/** Latest USER pick per key (by date, then id), from your own shares, of categories you still have. */
function lastPicks(
	shares: readonly ShareForCategory[],
	known: ReadonlySet<string>,
	keyOf: (s: ShareForCategory) => string | null,
): Map<string, string> {
	const picked = shares
		.filter(
			(s) =>
				s.categorySource === "USER" &&
				s.categoryId !== null &&
				known.has(s.categoryId),
		)
		.sort((a, b) =>
			a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.id < b.id ? -1 : 1,
		);
	const out = new Map<string, string>();
	for (const s of picked) {
		const key = keyOf(s);
		if (key) out.set(key, s.categoryId as string);
	}
	return out;
}

/** Resolves every share's category: stored choice first, then the smart default. */
export function resolveShareCategories(
	shares: readonly ShareForCategory[],
	mine: readonly MyCategory[],
): Map<string, ShareCategoryChoice> {
	const byName = new Map(mine.map((c) => [norm(c.name), c.id]));
	const known = new Set(mine.map((c) => c.id));
	const byProject = lastPicks(shares, known, (s) => s.projectId);
	const byPayer = lastPicks(shares, known, (s) => s.payer);
	const out = new Map<string, ShareCategoryChoice>();
	for (const s of shares) {
		out.set(s.id, choose(s, { byName, known, byProject, byPayer }));
	}
	return out;
}

function choose(
	s: ShareForCategory,
	ctx: {
		byName: Map<string, string>;
		known: Set<string>;
		byProject: Map<string, string>;
		byPayer: Map<string, string>;
	},
): ShareCategoryChoice {
	if (s.categoryId && ctx.known.has(s.categoryId))
		return { categoryId: s.categoryId, source: s.categorySource ?? "USER" };
	// You created it in your own category: that one is already yours.
	if (s.creatorCategory?.isMine)
		return { categoryId: s.creatorCategory.id, source: null };
	const named = s.creatorCategory
		? ctx.byName.get(norm(s.creatorCategory.name))
		: undefined;
	if (named) return { categoryId: named, source: "NAME_MATCH" };
	const project = s.projectId ? ctx.byProject.get(s.projectId) : undefined;
	if (project) return { categoryId: project, source: "PROJECT" };
	const person = ctx.byPayer.get(s.payer);
	if (person) return { categoryId: person, source: "PERSON" };
	return { categoryId: null, source: null };
}
