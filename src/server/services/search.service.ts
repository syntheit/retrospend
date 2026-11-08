import type { Keyring } from "~/server/crypto/field-crypto";
import type { db as globalDb } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import { Prisma } from "~prisma";
import { foldUnaccentIlike, readUserText, searchesInApp } from "./search-fold";

type AppDb = typeof globalDb;

/**
 * Accent- and case-insensitive search over what the caller can see. Every
 * query runs in a user transaction, so RLS applies to the raw SQL too, and
 * each one also names the caller's relationship to the row (owner,
 * participant) because some tables are readable more widely (public
 * projects, the user table). Matching is
 * `immutable_unaccent(column) ILIKE '%' || immutable_unaccent(q) || '%'`
 * (migration search_unaccent), so "cafe" finds "Café" and "MUNOZ" finds
 * "Muñoz". Expenses have two paths, picked by `searchesInApp`: the SQL match
 * above when no keyring is passed, and the same match in the app layer
 * (search-fold.ts) over a bounded window when text may be ciphertext.
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
 * How many of the newest finalized expenses the app-layer path reads (the
 * path used when a keyring is passed). Titles, descriptions and places may be
 * ciphertext there, so they are matched in the app and not in SQL; an older
 * expense than the newest SEARCH_EXPENSE_WINDOW is not found. One query per
 * call whatever the page or the hit count. The SQL path has no such limit.
 */
export const SEARCH_EXPENSE_WINDOW = 20_000;

type ExpenseCandidate = ExpenseHitRow & {
	description: string | null;
	location: string | null;
};

/**
 * Finalized expenses by title, description or place, newest first. Without a
 * keyring Postgres matches every row; with one the text may be ciphertext and
 * is matched in the app layer (searchExpensesInApp).
 */
export function searchExpenses(
	db: AppDb,
	userId: string,
	q: string,
	page: Page<{ date: string; id: string }>,
	options: {
		/** Opens ciphertext in text fields; passing one picks the app-layer path. */
		keyring?: Keyring;
		/** App-layer path only: rows read, for tests; SEARCH_EXPENSE_WINDOW otherwise. */
		window?: number;
	} = {},
): Promise<ExpenseHitRow[]> {
	const { keyring, window } = options;
	return searchesInApp(keyring)
		? searchExpensesInApp(db, userId, q, page, keyring, window)
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
 * The app-layer path, for text that may be ciphertext. The window and the
 * cursor are cut in SQL (so ordering and the cursor compare exactly as
 * before); the text is matched here.
 */
function searchExpensesInApp(
	db: AppDb,
	userId: string,
	q: string,
	page: Page<{ date: string; id: string }>,
	keyring: Keyring,
	windowSize: number = SEARCH_EXPENSE_WINDOW,
): Promise<ExpenseHitRow[]> {
	const size = windowSize;
	const needle = foldUnaccentIlike(q);
	const after = page.after
		? Prisma.sql`WHERE ("date", "id") < (${new Date(page.after.date)}, ${page.after.id})`
		: Prisma.empty;
	return userTransaction(db, userId, async (tx) => {
		const newest = await tx.$queryRaw<ExpenseCandidate[]>`
			SELECT * FROM (
				SELECT "id", "title", "date", "amount"::text AS "amount", "currency", "categoryId",
					"description", "location"
				FROM "expense"
				WHERE "userId" = ${userId}
					AND "status" = 'FINALIZED'
					AND "isAmortizedChild" = false
				ORDER BY "date" DESC, "id" DESC
				LIMIT ${size}
			) newest
			${after}
			ORDER BY "date" DESC, "id" DESC`;
		const hits: ExpenseHitRow[] = [];
		for (const row of newest) {
			const text = (column: string, value: string | null) =>
				readUserText(keyring, value, {
					table: "expense",
					column,
					rowId: row.id,
				});
			const title = text("title", row.title);
			const found = [
				title,
				text("description", row.description),
				text("location", row.location),
			].some((t) => foldUnaccentIlike(t).includes(needle));
			if (!found) continue;
			hits.push({
				id: row.id,
				title,
				date: row.date,
				amount: row.amount,
				currency: row.currency,
				categoryId: row.categoryId,
			});
			if (hits.length === page.take) break;
		}
		return hits;
	});
}

export type PersonHitRow = {
	participantType: "user" | "shadow";
	id: string;
	name: string;
	username: string | null;
};

/**
 * People: users the caller shares an expense or a project with, by name or
 * username, and the people they added by name (shadows RLS lets them see;
 * a claimed shadow shows as its user instead). By name.
 */
export function searchPeople(
	db: AppDb,
	userId: string,
	q: string,
	page: Page<{ name: string; participantType: string; id: string }>,
): Promise<PersonHitRow[]> {
	const p = containsPattern(q);
	const after = page.after
		? Prisma.sql`WHERE ("name", "participantType", "id") > (${page.after.name}, ${page.after.participantType}, ${page.after.id})`
		: Prisma.empty;
	return userTransaction(
		db,
		userId,
		(tx) => tx.$queryRaw<PersonHitRow[]>`
			SELECT * FROM (
				SELECT 'user' AS "participantType", u."id", u."name", u."username"
				FROM "user" u
				WHERE u."id" <> ${userId}
					AND (${matches(Prisma.sql`u."name"`, p)} OR ${matches(Prisma.sql`u."username"`, p)})
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
				UNION ALL
				SELECT 'shadow', s."id", s."name", NULL
				FROM "shadow_profile" s
				WHERE s."claimedById" IS NULL AND ${matches(Prisma.sql`s."name"`, p)}
			) people
			${after}
			ORDER BY "name", "participantType", "id"
			LIMIT ${page.take}`,
	);
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
	const p = containsPattern(q);
	const after = page.after
		? Prisma.sql`AND (pr."name", pr."id") > (${page.after.name}, ${page.after.id})`
		: Prisma.empty;
	return userTransaction(
		db,
		userId,
		(tx) => tx.$queryRaw<ProjectHitRow[]>`
			SELECT pr."id", pr."name", pr."status"::text AS "status"
			FROM "project" pr
			WHERE EXISTS (
					SELECT 1 FROM "project_participant" pp
					WHERE pp."projectId" = pr."id"
						AND pp."participantType" = 'user' AND pp."participantId" = ${userId})
				AND (${matches(Prisma.sql`pr."name"`, p)}
					OR ${matches(Prisma.sql`coalesce(pr."description", '')`, p)})
				${after}
			ORDER BY pr."name", pr."id"
			LIMIT ${page.take}`,
	);
}

export type CategoryHitRow = { id: string; name: string; color: string };

/** The caller's categories by name. */
export function searchCategories(
	db: AppDb,
	userId: string,
	q: string,
	page: Page<{ name: string; id: string }>,
): Promise<CategoryHitRow[]> {
	const p = containsPattern(q);
	const after = page.after
		? Prisma.sql`AND ("name", "id") > (${page.after.name}, ${page.after.id})`
		: Prisma.empty;
	return userTransaction(
		db,
		userId,
		(tx) => tx.$queryRaw<CategoryHitRow[]>`
			SELECT "id", "name", "color"::text AS "color"
			FROM "category"
			WHERE "userId" = ${userId} AND ${matches(Prisma.sql`"name"`, p)}
				${after}
			ORDER BY "name", "id"
			LIMIT ${page.take}`,
	);
}
