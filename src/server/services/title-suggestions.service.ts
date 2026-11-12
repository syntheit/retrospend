/**
 * Autocomplete for the expense title field: personal expense titles and
 * shared transactions the user is in, grouped case-insensitively and ordered
 * by use, each with the category and amount it was last used with.
 *
 * Personal titles have two paths, picked by `searchesInApp` (search-fold.ts):
 * Postgres groups and matches them in SQL when no keyring is passed (the case
 * today), and the same grouping happens in the app layer over decrypted
 * titles when one is, because SQL cannot read a sealed title (the client
 * opens it on read)
 * (docs/roadmap/e2ee-spike.md, lane D). Shared descriptions follow the same
 * two paths (the owner decided shared text is sealed too). Both paths hand
 * their groups to the same merge and ranking below, so the output is one
 * function of the groups.
 */
import type { Keyring } from "~/server/crypto/field-crypto";
import type { PrismaClient } from "~prisma";
import {
	APP_LAYER_WINDOW,
	ilikeContains,
	searchesInAppLoaded,
} from "./search-fold";
import { listedEntryWhere } from "./spending";

/**
 * How many of the newest personal expenses the app-layer path reads. Titles
 * older than that are neither counted nor offered on that path; the SQL path
 * has no such limit. One query per call.
 */
export const TITLE_SUGGESTION_WINDOW = APP_LAYER_WINDOW;

/** Distinct titles kept per source, and suggestions returned. */
const GROUPS_PER_SOURCE = 15;
const SUGGESTIONS = 8;

type Group = { text: string; count: number };
type LastUsed = { categoryId: string | null; amount: number; currency: string };
/** Personal title groups, and the last use of the titles that made the cut. */
type Personal = {
	groups: Group[];
	lastUsed: (titles: string[]) => Promise<Map<string, LastUsed>>;
};

/** Most used first; equal counts by text, so the order never depends on the database. */
const byUse = (a: Group, b: Group) =>
	b.count - a.count || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0);

export async function titleSuggestions(
	db: PrismaClient,
	userId: string,
	query: string,
	options: {
		/** Opens ciphertext in titles; passing one picks the app-layer path. */
		keyring?: Keyring;
		/** App-layer path only: rows read, for tests; TITLE_SUGGESTION_WINDOW otherwise. */
		window?: number;
	} = {},
) {
	const { keyring, window } = options;
	const inApp = await searchesInAppLoaded(keyring);
	const [personal, sharedGroups] = await Promise.all([
		inApp
			? personalInApp(db, userId, query, window)
			: personalInSql(db, userId, query),
		inApp
			? sharedInApp(db, userId, query, window)
			: sharedInSql(db, userId, query),
	]);

	// Merge counts by title (case-insensitive), preserving canonical casing
	const countMap = new Map<string, number>();
	const canonicalTitle = new Map<string, string>();
	for (const g of [...personal.groups].sort(byUse)) {
		const key = g.text.toLowerCase();
		if (!canonicalTitle.has(key)) canonicalTitle.set(key, g.text);
		countMap.set(key, (countMap.get(key) ?? 0) + g.count);
	}
	for (const g of [...sharedGroups].sort(byUse)) {
		const key = g.text.toLowerCase();
		if (!canonicalTitle.has(key)) canonicalTitle.set(key, g.text);
		countMap.set(key, (countMap.get(key) ?? 0) + g.count);
	}

	const sorted = [...countMap.entries()]
		.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
		.slice(0, SUGGESTIONS);

	if (sorted.length === 0) return [];

	// Get the most recent expense's category and amount for each top title
	const topTitles = sorted.map(([key]) => canonicalTitle.get(key) ?? key);
	const lastUsed = await personal.lastUsed(topTitles);

	return sorted.map(([lowKey, count]) => {
		const last = lastUsed.get(lowKey);
		return {
			title: canonicalTitle.get(lowKey) ?? lowKey,
			count,
			lastCategoryId: last?.categoryId ?? null,
			lastAmount: last?.amount ?? null,
			lastCurrency: last?.currency ?? null,
		};
	});
}

/** The SQL path: Postgres matches and groups every personal expense. */
async function personalInSql(
	db: PrismaClient,
	userId: string,
	query: string,
): Promise<Personal> {
	const groups = await db.expense.groupBy({
		by: ["title"],
		where: {
			...listedEntryWhere(userId),
			title: { contains: query, mode: "insensitive" },
		},
		_count: { title: true },
		orderBy: { _count: { title: "desc" } },
		take: GROUPS_PER_SOURCE,
	});
	return {
		groups: groups.map((g) => ({ text: g.title, count: g._count.title })),
		lastUsed: async (titles) => {
			const rows = await db.expense.findMany({
				where: { ...listedEntryWhere(userId), title: { in: titles } },
				orderBy: [{ date: "desc" }, { id: "desc" }],
				select: {
					title: true,
					categoryId: true,
					amount: true,
					currency: true,
				},
				distinct: ["title"],
			});
			return firstPerKey(
				rows.map((e) => ({
					title: e.title,
					categoryId: e.categoryId,
					amount: Number(e.amount),
					currency: e.currency,
				})),
			);
		},
	};
}

/**
 * The app-layer path: read the newest expenses (the client opens each title,
 * field-open.ts) and match
 * and group here. `contains ... mode: insensitive` is `ILIKE '%q%'` with q
 * unescaped, which lowercases both sides one code point at a time, does not
 * fold accents and reads `%`, `_` and backslash in q as pattern characters;
 * `ilikeContains` does the same. Rows come in the same (date, id) order the
 * SQL path uses for the last use of a title.
 */
async function personalInApp(
	db: PrismaClient,
	userId: string,
	query: string,
	window: number = TITLE_SUGGESTION_WINDOW,
): Promise<Personal> {
	const matches = ilikeContains(query);
	const rows = await db.expense.findMany({
		where: listedEntryWhere(userId),
		orderBy: [{ date: "desc" }, { id: "desc" }],
		take: window,
		select: {
			id: true,
			title: true,
			categoryId: true,
			amount: true,
			currency: true,
		},
	});
	const opened = rows.map((r) => ({
		title: r.title,
		categoryId: r.categoryId,
		amount: Number(r.amount),
		currency: r.currency,
	}));

	const counts = new Map<string, number>();
	for (const r of opened)
		if (matches(r.title)) counts.set(r.title, (counts.get(r.title) ?? 0) + 1);
	const groups = [...counts.entries()]
		.map(([text, count]) => ({ text, count }))
		.sort(byUse)
		.slice(0, GROUPS_PER_SOURCE);

	return {
		groups,
		lastUsed: async (titles) => {
			const wanted = new Set(titles);
			return firstPerKey(opened.filter((r) => wanted.has(r.title)));
		},
	};
}

/**
 * The app-layer path for shared descriptions, which are encrypted like
 * personal titles (the owner decided shared text is sealed with an
 * instance-wide key): the newest shared expenses the user is a participant
 * of are read (opened by the client), matched and grouped here, as
 * `personalInApp` does.
 */
async function sharedInApp(
	db: PrismaClient,
	userId: string,
	query: string,
	window: number = TITLE_SUGGESTION_WINDOW,
): Promise<Group[]> {
	const matches = ilikeContains(query);
	const rows = await db.sharedTransaction.findMany({
		where: {
			splitParticipants: {
				some: { participantType: "user", participantId: userId },
			},
		},
		orderBy: [{ date: "desc" }, { id: "desc" }],
		take: window,
		select: { id: true, description: true },
	});
	const counts = new Map<string, number>();
	for (const r of rows) {
		const text = r.description;
		if (matches(text)) counts.set(text, (counts.get(text) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([text, count]) => ({ text, count }))
		.sort(byUse)
		.slice(0, GROUPS_PER_SOURCE);
}

/** The SQL path for shared descriptions: Postgres matches and groups every one the user is in. */
async function sharedInSql(
	db: PrismaClient,
	userId: string,
	query: string,
): Promise<Group[]> {
	const groups = await db.sharedTransaction.groupBy({
		by: ["description"],
		where: {
			description: { contains: query, mode: "insensitive" },
			splitParticipants: {
				some: { participantType: "user", participantId: userId },
			},
		},
		_count: { description: true },
		orderBy: { _count: { description: "desc" } },
		take: GROUPS_PER_SOURCE,
	});
	return groups.map((g) => ({
		text: g.description,
		count: g._count.description,
	}));
}

/** The first row of each title (case-insensitive), rows being newest first. */
function firstPerKey(
	rows: (LastUsed & { title: string })[],
): Map<string, LastUsed> {
	const out = new Map<string, LastUsed>();
	for (const r of rows) {
		const key = r.title.toLowerCase();
		if (!out.has(key))
			out.set(key, {
				categoryId: r.categoryId,
				amount: r.amount,
				currency: r.currency,
			});
	}
	return out;
}
