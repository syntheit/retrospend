/**
 * Autocomplete for the expense title field: personal expense titles and
 * shared transactions the user is in, grouped case-insensitively and ordered
 * by use, each with the category and amount it was last used with.
 *
 * Personal titles have two paths, picked by `searchesInAppLoaded`
 * (search-fold.ts): Postgres groups and matches them in SQL before the field
 * encryption epoch, and the same grouping happens in the app layer over
 * opened titles once a title may be sealed (docs/roadmap/e2ee-spike.md, lane
 * D), over every row in batches (scan-batches.ts). Shared descriptions follow
 * the same two paths (the owner decided shared text is sealed too). Both
 * paths hand their groups to the same merge and ranking below, so the output
 * is one function of the groups.
 */
import type { Keyring } from "~/server/crypto/field-crypto";
import type { PrismaClient } from "~prisma";
import { dateIdOf, olderThan, scanBatches } from "./scan-batches";
import { ilikeContains, searchesInAppLoaded } from "./search-fold";
import { listedEntryWhere } from "./spending";

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
		/** Passing one picks the app-layer path, in tests. */
		keyring?: Keyring;
	} = {},
) {
	const inApp = await searchesInAppLoaded(options.keyring);
	// One after the other: a request holds one connection at a time.
	const personal = await (inApp
		? personalInApp(db, userId, query)
		: personalInSql(db, userId, query));
	const sharedGroups = await (inApp
		? sharedInApp(db, userId, query)
		: sharedInSql(db, userId, query));

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
 * The app-layer path: every listed expense, newest first by (date, id), in
 * batches (the client opens each title, field-open.ts), matched and grouped
 * here; each batch keeps only the counts and the newest use of each matching
 * title. `contains ... mode: insensitive` is `ILIKE '%q%'` with q unescaped,
 * which lowercases both sides one code point at a time, does not fold accents
 * and reads `%`, `_` and backslash in q as pattern characters; `ilikeContains`
 * does the same. The SQL path's last use is the newest row of the exact title
 * in the same order. A row read twice (its date edited mid-scan) counts once.
 */
async function personalInApp(
	db: PrismaClient,
	userId: string,
	query: string,
): Promise<Personal> {
	const matches = ilikeContains(query);
	const counts = new Map<string, number>();
	const newest = new Map<string, LastUsed>();
	const seen = new Set<string>();
	await scanBatches(db, userId, {
		start: null,
		read: (tx, after, take) =>
			tx.expense.findMany({
				where: { ...listedEntryWhere(userId), ...olderThan(after) },
				orderBy: [{ date: "desc" }, { id: "desc" }],
				take,
				select: {
					id: true,
					date: true,
					title: true,
					categoryId: true,
					amount: true,
					currency: true,
				},
			}),
		cursorOf: dateIdOf,
		visit: (rows) => {
			for (const r of rows) {
				if (seen.has(r.id) || !matches(r.title)) continue;
				seen.add(r.id);
				counts.set(r.title, (counts.get(r.title) ?? 0) + 1);
				if (!newest.has(r.title))
					newest.set(r.title, {
						categoryId: r.categoryId,
						amount: Number(r.amount),
						currency: r.currency,
					});
			}
			return false;
		},
	});
	const groups = [...counts.entries()]
		.map(([text, count]) => ({ text, count }))
		.sort(byUse)
		.slice(0, GROUPS_PER_SOURCE);

	return {
		groups,
		lastUsed: async (titles) =>
			firstPerKey(
				titles.flatMap((title) => {
					const last = newest.get(title);
					return last ? [{ title, ...last }] : [];
				}),
			),
	};
}

/**
 * The app-layer path for shared descriptions, which are encrypted like
 * personal titles (the owner decided shared text is sealed with an
 * instance-wide key): every shared expense the user is a participant of, in
 * batches as `personalInApp` reads, opened by the client, matched and grouped
 * here.
 */
async function sharedInApp(
	db: PrismaClient,
	userId: string,
	query: string,
): Promise<Group[]> {
	const matches = ilikeContains(query);
	const counts = new Map<string, number>();
	const seen = new Set<string>();
	await scanBatches(db, userId, {
		start: null,
		read: (tx, after, take) =>
			tx.sharedTransaction.findMany({
				where: {
					splitParticipants: {
						some: { participantType: "user", participantId: userId },
					},
					...olderThan(after),
				},
				orderBy: [{ date: "desc" }, { id: "desc" }],
				take,
				select: { id: true, date: true, description: true },
			}),
		cursorOf: dateIdOf,
		visit: (rows) => {
			for (const r of rows) {
				const text = r.description;
				if (seen.has(r.id) || !matches(text)) continue;
				seen.add(r.id);
				counts.set(text, (counts.get(text) ?? 0) + 1);
			}
			return false;
		},
	});
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
