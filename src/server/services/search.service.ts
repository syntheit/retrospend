import type { db as globalDb } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import { Prisma } from "~prisma";

type AppDb = typeof globalDb;

/**
 * Accent- and case-insensitive search over what the caller can see. Every
 * query runs in a user transaction, so RLS applies to the raw SQL too, and
 * each one also names the caller's relationship to the row (owner,
 * participant) because some tables are readable more widely (public
 * projects, the user table). Matching is
 * `immutable_unaccent(column) ILIKE '%' || immutable_unaccent(q) || '%'`
 * (migration search_unaccent), so "cafe" finds "Café" and "MUNOZ" finds
 * "Muñoz".
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

/** Finalized expenses by title, description or place, newest first. */
export function searchExpenses(
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
