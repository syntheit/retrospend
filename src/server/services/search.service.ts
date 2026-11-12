import type { db as globalDb } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import { Prisma } from "~prisma";
import { scanBatches } from "./scan-batches";
import {
	APP_LAYER_WINDOW,
	foldUnaccentIlike,
	searchesInAppLoaded,
} from "./search-fold";
import { compareText, sortByText } from "./text-order";

type AppDb = typeof globalDb;

/**
 * Accent- and case-insensitive search over what the caller can see. Every
 * query runs in a user transaction, so RLS applies to the raw SQL too, and
 * each one also names the caller's relationship to the row (owner,
 * participant) because some tables are readable more widely (public
 * projects, the user table). Matching is
 * `immutable_unaccent(column) ILIKE '%' || immutable_unaccent(q) || '%'`
 * (migration search_unaccent), so "cafe" finds "Café" and "MUNOZ" finds
 * "Muñoz". Expenses have two paths, picked by `searchesInAppLoaded`: the SQL
 * match above before the field encryption epoch, and the same match in the
 * app layer (search-fold.ts) over every row once text may be ciphertext. People,
 * projects and categories always match in the app layer (see below).
 */

type Page<K> = { after: K | null; take: number };

/** `%q%` with LIKE wildcards in q taken literally. */
function containsPattern(q: string): string {
	return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function matches(column: Prisma.Sql, pattern: string): Prisma.Sql {
	return Prisma.sql`public.immutable_unaccent(${column}) ILIKE public.immutable_unaccent(${pattern}) ESCAPE '\\'`;
}

export type ExpenseHitRow = {
	id: string;
	title: string;
	date: Date;
	amount: string;
	currency: string;
	categoryId: string | null;
};

/**
 * Finalized expenses by title, description or place, newest first. Before
 * the field encryption epoch Postgres matches every row; after it the text
 * may be ciphertext and is matched in the app layer (searchExpensesInApp).
 */
export async function searchExpenses(
	db: AppDb,
	userId: string,
	q: string,
	page: Page<{ date: string; id: string }>,
	/** App-layer path only: rows per batch, for tests. */
	options: { batch?: number } = {},
): Promise<ExpenseHitRow[]> {
	return (await searchesInAppLoaded())
		? searchExpensesInApp(db, userId, q, page, options.batch)
		: searchExpensesInSql(db, userId, q, page);
}

/** The SQL path: Postgres matches title, description and place over every row. */
function searchExpensesInSql(
	db: AppDb,
	userId: string,
	q: string,
	page: Page<{ date: string; id: string }>,
): Promise<ExpenseHitRow[]> {
	const p = containsPattern(q);
	const after = page.after
		? Prisma.sql`AND ("date", "id") < (${new Date(page.after.date)}, ${page.after.id})`
		: Prisma.empty;
	return userTransaction(
		db,
		userId,
		(tx) => tx.$queryRaw<ExpenseHitRow[]>`
			SELECT "id", "title", "date", "amount"::text AS "amount", "currency", "categoryId"
			FROM "expense"
			WHERE "userId" = ${userId}
				AND "status" = 'FINALIZED'
				AND "isAmortizedChild" = false
				AND (${matches(Prisma.sql`"title"`, p)}
					OR ${matches(Prisma.sql`coalesce("description", '')`, p)}
					OR ${matches(Prisma.sql`coalesce("location", '')`, p)})
				${after}
			ORDER BY "date" DESC, "id" DESC
			LIMIT ${page.take}`,
	);
}

/**
 * The app-layer path, for text that may be ciphertext: every expense from the
 * cursor on, newest first, in batches (scan-batches.ts) keyed on the unmapped
 * (date, id), the text opened by the model read and matched here, until the
 * page is full. A row read twice (its date edited mid-scan) counts once.
 */
async function searchExpensesInApp(
	db: AppDb,
	userId: string,
	q: string,
	page: Page<{ date: string; id: string }>,
	batch: number | undefined,
): Promise<ExpenseHitRow[]> {
	const needle = foldUnaccentIlike(q);
	const hits = new Map<string, ExpenseHitRow>();
	await scanBatches(db, userId, {
		batch,
		start: page.after
			? { date: new Date(page.after.date), id: page.after.id }
			: null,
		read: (tx, after, take) =>
			tx.expense.findMany({
				where: {
					userId,
					status: "FINALIZED",
					isAmortizedChild: false,
					...(after && {
						OR: [
							{ date: { lt: after.date } },
							{ date: after.date, id: { lt: after.id } },
						],
					}),
				},
				orderBy: [{ date: "desc" }, { id: "desc" }],
				take,
				select: {
					id: true,
					title: true,
					description: true,
					location: true,
					date: true,
					amount: true,
					currency: true,
					categoryId: true,
				},
			}),
		cursorOf: (row) => ({ date: row.date, id: row.id }),
		visit: (rows) => {
			for (const row of rows) {
				if (hits.has(row.id)) continue;
				const texts = [row.title, row.description ?? "", row.location ?? ""];
				if (!texts.some((t) => foldUnaccentIlike(t).includes(needle))) continue;
				hits.set(row.id, {
					id: row.id,
					title: row.title,
					date: row.date,
					amount: row.amount.toString(),
					currency: row.currency,
					categoryId: row.categoryId,
				});
				if (hits.size === page.take) return true;
			}
			return false;
		},
	});
	return [...hits.values()];
}

export type PersonHitRow = {
	participantType: "user" | "shadow";
	id: string;
	name: string;
	username: string | null;
};

/** Whether `text` holds `q` the way `immutable_unaccent(text) ILIKE '%q%'` does. */
function foldedMatcher(q: string): (text: string) => boolean {
	const needle = foldUnaccentIlike(q);
	return (text) => foldUnaccentIlike(text).includes(needle);
}

/**
 * People, projects and categories are read as rows and matched, sorted and
 * paged here, not in SQL: names may be ciphertext, so Postgres can neither
 * match nor order them (docs/roadmap/e2ee-spike.md, lane D). Projects and
 * categories are the caller's own, so all of them are read. Text columns come
 * through model reads, which hand back plaintext; SQL only picks ids.
 *
 * People: users the caller shares an expense or a project with, by name or
 * username, and the people they added by name (shadows RLS lets them see;
 * a claimed shadow shows as its user instead). By name. Other project members
 * can add ghosts and join projects, so this set can grow without the caller
 * doing anything: the newest `window` users (by account creation) and the
 * newest `window` ghosts are read, APP_LAYER_WINDOW each. A person beyond that
 * is not found by search.
 */
export function searchPeople(
	db: AppDb,
	userId: string,
	q: string,
	page: Page<{ name: string; participantType: string; id: string }>,
	options: { window?: number } = {},
): Promise<PersonHitRow[]> {
	const window = options.window ?? APP_LAYER_WINDOW;
	const match = foldedMatcher(q);
	return userTransaction(db, userId, async (tx) => {
		const known = await tx.$queryRaw<{ id: string }[]>`
			SELECT u."id" FROM "user" u
			WHERE u."id" <> ${userId}
				AND (
					EXISTS (
						SELECT 1 FROM "split_participant" me
						JOIN "split_participant" them ON them."transactionId" = me."transactionId"
						WHERE me."participantType" = 'user' AND me."participantId" = ${userId}
							AND them."participantType" = 'user' AND them."participantId" = u."id")
					OR EXISTS (
						SELECT 1 FROM "project_participant" me
						JOIN "project_participant" them ON them."projectId" = me."projectId"
						WHERE me."participantType" = 'user' AND me."participantId" = ${userId}
							AND them."participantType" = 'user' AND them."participantId" = u."id")
				)
			ORDER BY u."createdAt" DESC, u."id" DESC
			LIMIT ${window}`;
		const [users, shadows] = await Promise.all([
			tx.user.findMany({
				where: { id: { in: known.map((k) => k.id) } },
				select: { id: true, name: true, username: true },
			}),
			tx.shadowProfile.findMany({
				where: { claimedById: null },
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				take: window,
				select: { id: true, name: true },
			}),
		]);
		const rows: PersonHitRow[] = [
			...users
				.filter((u) => match(u.name) || match(u.username))
				.map((u) => ({
					participantType: "user" as const,
					id: u.id,
					name: u.name,
					username: u.username,
				})),
			...shadows
				.filter((s) => match(s.name))
				.map((s) => ({
					participantType: "shadow" as const,
					id: s.id,
					name: s.name,
					username: null,
				})),
		].sort(
			(a, b) =>
				compareText(a.name, b.name) ||
				compareText(a.participantType, b.participantType) ||
				compareText(a.id, b.id),
		);
		const cursor = page.after;
		const later = cursor
			? rows.filter(
					(r) =>
						(compareText(r.name, cursor.name) ||
							compareText(r.participantType, cursor.participantType) ||
							compareText(r.id, cursor.id)) > 0,
				)
			: rows;
		return later.slice(0, page.take);
	});
}

export type ProjectHitRow = {
	id: string;
	name: string;
	status: "ACTIVE" | "ARCHIVED";
};

/** Projects the caller is a member of, by name or description. */
export function searchProjects(
	db: AppDb,
	userId: string,
	q: string,
	page: Page<{ name: string; id: string }>,
): Promise<ProjectHitRow[]> {
	const match = foldedMatcher(q);
	return userTransaction(db, userId, async (tx) => {
		const projects = await tx.project.findMany({
			where: {
				participants: {
					some: { participantType: "user", participantId: userId },
				},
			},
			select: { id: true, name: true, description: true, status: true },
		});
		const hits = sortByText(
			projects.filter((p) => match(p.name) || match(p.description ?? "")),
			(p) => p.name,
		);
		return afterNameCursor(hits, page).map((p) => ({
			id: p.id,
			name: p.name,
			status: p.status,
		}));
	});
}

export type CategoryHitRow = { id: string; name: string; color: string };

/** The caller's categories by name. */
export function searchCategories(
	db: AppDb,
	userId: string,
	q: string,
	page: Page<{ name: string; id: string }>,
): Promise<CategoryHitRow[]> {
	const match = foldedMatcher(q);
	return userTransaction(db, userId, async (tx) => {
		const categories = await tx.category.findMany({
			where: { userId },
			select: { id: true, name: true, color: true },
		});
		const hits = sortByText(
			categories.filter((c) => match(c.name)),
			(c) => c.name,
		);
		return afterNameCursor(hits, page);
	});
}

/** Rows already sorted by name then id: the page after the cursor. */
function afterNameCursor<T extends { id: string; name: string }>(
	rows: readonly T[],
	page: Page<{ name: string; id: string }>,
): T[] {
	const cursor = page.after;
	const later = cursor
		? rows.filter(
				(r) =>
					compareText(r.name, cursor.name) > 0 ||
					(r.name === cursor.name && compareText(r.id, cursor.id) > 0),
			)
		: rows;
	return later.slice(0, page.take);
}
