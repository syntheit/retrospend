/**
 * The Activity page of keys: one UNION over personal expenses, your shares
 * of shared expenses and payments, filtered and sorted in Postgres so the
 * cursor and the count are exact across sources. The rows themselves are
 * read afterwards (rows.ts), only for the page.
 *
 * A text search has two paths, picked once per request (index.ts). Before
 * the field encryption epoch it is one more WHERE part in the SQL
 * (query-parts.ts), over every row. After it the text may be ciphertext, so
 * search-scan.ts matches it in the app layer first, the keys arrive as
 * `KeyQuery.matched`, and this file only cuts the page from them.
 */
import { Prisma } from "~prisma";
import {
	all,
	type KeyQuery,
	paymentGroups,
	paymentParts,
	personalParts,
	type RowKey,
	SHARED_JOIN,
	sharedParts,
	sources,
} from "./query-parts";
import { byKeyDesc, type CursorKey } from "./search";

export type { KeyQuery, ListBounds, RowKey } from "./query-parts";

type Db = Prisma.TransactionClient;

/** One branch's page: its cursor test and its own ORDER BY and LIMIT. */
export type Page = { after: CursorKey | null; take: number };

export function pageOf(
	src: RowKey["src"],
	date: Prisma.Sql,
	created: Prisma.Sql,
	id: Prisma.Sql,
	page: Page | undefined,
) {
	if (!page) return { where: null, tail: Prisma.empty };
	const a = page.after;
	return {
		// Same key order as the outer query; src is constant per branch.
		where: a
			? Prisma.sql`(${date}, ${created}, ${src}::text, ${id}) < (${a.date}, ${a.created}, ${a.src}, ${a.id})`
			: null,
		tail: Prisma.sql`ORDER BY ${date} DESC, ${created} DESC, ${id} DESC LIMIT ${page.take}`,
	};
}

function personal(k: KeyQuery, page?: Page): Prisma.Sql {
	const parts = personalParts(k);
	const pg = pageOf(
		"p",
		Prisma.sql`e.date`,
		Prisma.sql`e."createdAt"`,
		Prisma.sql`e.id`,
		page,
	);
	if (pg.where) parts.push(pg.where);
	return Prisma.sql`(SELECT 'p'::text AS src, e.id AS id, e.date AS date, e."createdAt" AS created FROM expense e WHERE ${all(parts)} ${pg.tail})`;
}

function shared(k: KeyQuery, page?: Page): Prisma.Sql {
	const parts = sharedParts(k);
	const pg = pageOf(
		"s",
		Prisma.sql`st.date`,
		Prisma.sql`st."createdAt"`,
		Prisma.sql`st.id`,
		page,
	);
	if (pg.where) parts.push(pg.where);
	return Prisma.sql`(SELECT 's'::text AS src, st.id AS id, st.date AS date, st."createdAt" AS created
		${SHARED_JOIN(k.userId)}
		WHERE ${all(parts)} ${pg.tail})`;
}

function payments(k: KeyQuery, page?: Page): Prisma.Sql {
	const parts = paymentParts(k);
	const pg = pageOf(
		"g",
		Prisma.sql`g.date`,
		Prisma.sql`g.date`,
		Prisma.sql`g.key`,
		page,
	);
	if (pg.where) parts.push(pg.where);
	return Prisma.sql`(SELECT 'g'::text AS src, g.key AS id, g.date AS date, g.date AS created FROM ${paymentGroups(k, Prisma.empty)} WHERE ${all(parts)} ${pg.tail})`;
}

/** The branches, each already cut to the page when `page` is given. */
function union(k: KeyQuery, page?: Page): Prisma.Sql | null {
	const w = sources(k);
	const parts: Prisma.Sql[] = [];
	if (w.personal) parts.push(personal(k, page));
	if (w.shared) parts.push(shared(k, page));
	if (w.payment) parts.push(payments(k, page));
	return parts.length ? Prisma.join(parts, " UNION ALL ") : null;
}

/**
 * One page of row keys after `after`, newest first (by date, then by when it was added). Each branch applies the
 * cursor and the limit itself, so Postgres never sorts more than `take` rows
 * per source; the outer sort merges them. An app-layer search cuts its
 * matched keys instead (see the top of this file).
 */
export async function pageKeys(
	db: Db,
	k: KeyQuery,
	after: CursorKey | null,
	take: number,
): Promise<RowKey[]> {
	if (k.matched)
		return k.matched
			.filter((row) => !after || byKeyDesc(row, after) > 0)
			.slice(0, take);
	const u = union(k, { after, take });
	if (!u) return [];
	return db.$queryRaw<
		RowKey[]
	>`SELECT u.src, u.id, u.date, u.created FROM (${u}) u
		ORDER BY u.date DESC, u.created DESC, u.src DESC, u.id DESC LIMIT ${take}`;
}

/** How many rows the filter matches across every page. */
export async function countKeys(db: Db, k: KeyQuery): Promise<number> {
	if (k.matched) return k.matched.length;
	const u = union(k);
	if (!u) return 0;
	const [row] = await db.$queryRaw<
		{ n: number }[]
	>`SELECT count(*)::int AS n FROM (${u}) u`;
	return row?.n ?? 0;
}
