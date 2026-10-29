/**
 * The Activity page of keys: one UNION over personal expenses, your shares
 * of shared expenses and payments, filtered and sorted in Postgres so the
 * cursor and the count are exact across sources. The rows themselves are
 * read afterwards (rows.ts), only for the page.
 */
import { Prisma } from "~prisma";
import {
	amountCandidates,
	type CursorKey,
	FOLD_FROM,
	FOLD_TO,
	likePattern,
} from "./search";
import { type ActivityKind, type ListV2Filter, NO_CATEGORY } from "./types";

type Db = Prisma.TransactionClient;

export type ListBounds = { gte?: Date; lt?: Date };

export type KeyQuery = {
	userId: string;
	filter: ListV2Filter;
	bounds: ListBounds;
	/** Projects you hide from analytics; today's list leaves them out too. */
	excludedProjectIds: string[];
	/** One row only, by its source and key (GET /expenses/row). */
	only?: { src: RowKey["src"]; id: string };
};

export type RowKey = { src: "p" | "s" | "g"; id: string; date: Date };

const fold = (col: Prisma.Sql) =>
	Prisma.sql`lower(translate(${col}, ${FOLD_FROM}, ${FOLD_TO}))`;

const all = (parts: Prisma.Sql[]) =>
	parts.length ? Prisma.join(parts, " AND ") : Prisma.sql`TRUE`;

function dateParts(col: Prisma.Sql, b: ListBounds): Prisma.Sql[] {
	const out: Prisma.Sql[] = [];
	if (b.gte) out.push(Prisma.sql`${col} >= ${b.gte}`);
	if (b.lt) out.push(Prisma.sql`${col} < ${b.lt}`);
	return out;
}

/** Text columns that fold-match the search, or an amount equal to a typed number. */
function searchPart(
	q: string | undefined,
	texts: Prisma.Sql[],
	amounts: Prisma.Sql[],
): Prisma.Sql | null {
	if (!q?.trim()) return null;
	const pattern = likePattern(q);
	const nums = amountCandidates(q);
	const ors = texts.map((t) => Prisma.sql`${fold(t)} LIKE ${pattern}`);
	if (nums.length)
		for (const a of amounts)
			ors.push(Prisma.sql`${a} = ANY(${nums}::numeric[])`);
	return Prisma.sql`(${Prisma.join(ors, " OR ")})`;
}

const has = (list?: readonly unknown[]) => !!list && list.length > 0;

/** Personal entry kinds a Type pick lists; reimbursements have no rows yet (2D). */
const PERSONAL_KIND_SQL: Partial<Record<ActivityKind, Prisma.Sql>> = {
	expense: Prisma.sql`(e.direction = 'OUT' AND e."entryKind" = 'STANDARD')`,
	in: Prisma.sql`(e.direction = 'IN' AND e."entryKind" = 'STANDARD' AND e."inType" IS DISTINCT FROM 'REFUND')`,
	refund: Prisma.sql`(e.direction = 'IN' AND e."entryKind" = 'STANDARD' AND e."inType" = 'REFUND')`,
	transfer: Prisma.sql`e."entryKind" = 'NOT_SPENDING'`,
};

/**
 * The category filter on `col`: the picked ids, and with NO_CATEGORY the
 * rows `none` says have no category.
 */
function categoryPart(
	col: Prisma.Sql,
	picked: readonly string[],
	none: Prisma.Sql,
): Prisma.Sql {
	const ids = picked.filter((id) => id !== NO_CATEGORY);
	const ors: Prisma.Sql[] = [];
	if (ids.length) ors.push(Prisma.sql`${col} = ANY(${ids}::text[])`);
	if (picked.includes(NO_CATEGORY)) ors.push(none);
	return Prisma.sql`(${Prisma.join(ors, " OR ")})`;
}

/**
 * Personal spending and refunds with no category (money in and transfers
 * never have one, so they are not "no category").
 */
const PERSONAL_NONE = Prisma.sql`(e."categoryId" IS NULL AND e."entryKind" = 'STANDARD' AND (e.direction = 'OUT' OR e."inType" = 'REFUND'))`;

/**
 * A share with no category as spent() counts it: the expense has none, or
 * its category is another person's (their categories cannot be used here,
 * D19), so Insights' No category and this filter name the same rows.
 */
const sharedNone = (userId: string) =>
	Prisma.sql`(st."categoryId" IS NULL OR NOT EXISTS (SELECT 1 FROM category c WHERE c.id = st."categoryId" AND c."userId" = ${userId}))`;

/**
 * Which personal rows a Type filter lists. No pick lists every kind a person
 * reads as an entry; starting balances and adjustments are budget
 * bookkeeping and never show (budget SPEC §5.2).
 */
export function personalKinds(
	kinds: readonly ActivityKind[],
): Prisma.Sql | null {
	const picked = kinds.length
		? kinds
		: (Object.keys(PERSONAL_KIND_SQL) as ActivityKind[]);
	const parts = picked.flatMap((k) => PERSONAL_KIND_SQL[k] ?? []);
	return parts.length ? Prisma.sql`(${Prisma.join(parts, " OR ")})` : null;
}

function wants(f: ListV2Filter) {
	const kinds = f.kinds ?? [];
	const expense = !kinds.length || kinds.includes("expense");
	const payment = !kinds.length || kinds.includes("payment");
	return {
		personal:
			personalKinds(kinds) !== null &&
			!has(f.people) &&
			!has(f.projectIds) &&
			(!has(f.paidBy) || !!f.paidBy?.includes("me")),
		shared: expense,
		payment: payment && !has(f.categoryIds),
	};
}

/** One branch's page: its cursor test and its own ORDER BY and LIMIT. */
export type Page = { after: CursorKey | null; take: number };

function pageOf(
	src: RowKey["src"],
	date: Prisma.Sql,
	id: Prisma.Sql,
	page: Page | undefined,
) {
	if (!page) return { where: null, tail: Prisma.empty };
	const a = page.after;
	return {
		// Same key order as the outer query; src is constant per branch.
		where: a
			? Prisma.sql`(${date}, ${src}::text, ${id}) < (${a.date}, ${a.src}, ${a.id})`
			: null,
		tail: Prisma.sql`ORDER BY ${date} DESC, ${id} DESC LIMIT ${page.take}`,
	};
}

function personal(k: KeyQuery, page?: Page): Prisma.Sql {
	const f = k.filter;
	const parts = [
		Prisma.sql`e."userId" = ${k.userId}`,
		Prisma.sql`e.status = 'FINALIZED'`,
		Prisma.sql`e."isAmortizedChild" = false`,
		...dateParts(Prisma.sql`e.date`, k.bounds),
	];
	const kinds = personalKinds(f.kinds ?? []);
	if (kinds) parts.push(kinds);
	if (f.categoryIds && has(f.categoryIds))
		parts.push(
			categoryPart(Prisma.sql`e."categoryId"`, f.categoryIds, PERSONAL_NONE),
		);
	const s = searchPart(
		f.q,
		[
			Prisma.sql`e.title`,
			Prisma.sql`coalesce(e.description, '')`,
			Prisma.sql`coalesce(e.location, '')`,
		],
		[Prisma.sql`e.amount`],
	);
	if (s) parts.push(s);
	if (k.only) parts.push(Prisma.sql`e.id = ${k.only.id}`);
	const pg = pageOf("p", Prisma.sql`e.date`, Prisma.sql`e.id`, page);
	if (pg.where) parts.push(pg.where);
	return Prisma.sql`(SELECT 'p'::text AS src, e.id AS id, e.date AS date FROM expense e WHERE ${all(parts)} ${pg.tail})`;
}

const keyOf = (type: Prisma.Sql, id: Prisma.Sql) =>
	Prisma.sql`(${type}::text || ':' || ${id})`;

function payerKeys(k: KeyQuery): string[] {
	return (k.filter.paidBy ?? []).map((p) =>
		p === "me" ? `user:${k.userId}` : p,
	);
}

function shared(k: KeyQuery, page?: Page): Prisma.Sql {
	const f = k.filter;
	const parts = [
		Prisma.sql`(st."projectId" IS NULL OR NOT (st."projectId" = ANY(${k.excludedProjectIds}::text[])))`,
		...dateParts(Prisma.sql`st.date`, k.bounds),
	];
	if (f.categoryIds && has(f.categoryIds))
		parts.push(
			categoryPart(
				Prisma.sql`st."categoryId"`,
				f.categoryIds,
				sharedNone(k.userId),
			),
		);
	if (has(f.projectIds))
		parts.push(Prisma.sql`st."projectId" = ANY(${f.projectIds}::text[])`);
	// The payer counts too: RLS can hide the other split rows (rows.ts peopleOf).
	if (has(f.people))
		parts.push(
			Prisma.sql`(${keyOf(Prisma.sql`st."paidByType"`, Prisma.sql`st."paidById"`)} = ANY(${f.people}::text[])
				OR EXISTS (SELECT 1 FROM split_participant x WHERE x."transactionId" = st.id AND ${keyOf(Prisma.sql`x."participantType"`, Prisma.sql`x."participantId"`)} = ANY(${f.people}::text[])))`,
		);
	if (has(f.paidBy))
		parts.push(
			Prisma.sql`${keyOf(Prisma.sql`st."paidByType"`, Prisma.sql`st."paidById"`)} = ANY(${payerKeys(k)}::text[])`,
		);
	const s = searchPart(
		f.q,
		[Prisma.sql`st.description`, Prisma.sql`coalesce(st.notes, '')`],
		[Prisma.sql`st.amount`, Prisma.sql`sp."shareAmount"`],
	);
	if (s) parts.push(s);
	if (k.only) parts.push(Prisma.sql`st.id = ${k.only.id}`);
	const pg = pageOf("s", Prisma.sql`st.date`, Prisma.sql`st.id`, page);
	if (pg.where) parts.push(pg.where);
	return Prisma.sql`(SELECT 's'::text AS src, st.id AS id, st.date AS date
		FROM shared_transaction st
		JOIN split_participant sp ON sp."transactionId" = st.id
			AND sp."participantType" = 'user' AND sp."participantId" = ${k.userId}
		WHERE ${all(parts)} ${pg.tail})`;
}

/** Settlement rows that are cash moving: no offsets, forgives or rejected ones. */
const PAYMENT_ROW = Prisma.sql`s."isOffset" = false AND s.kind = 'PAYMENT' AND s.status <> 'REJECTED'`;

/**
 * One row per payment (MONEY-MOVES I4): the settlement rows of a payment
 * group in one currency. Offsets and forgiven balances move no cash, so they
 * are left out; a payment wholly inside projects you hide is left out like
 * their expenses.
 */
function payments(k: KeyQuery, page?: Page): Prisma.Sql {
	const f = k.filter;
	const me = `user:${k.userId}`;
	const from = keyOf(
		Prisma.sql`s."fromParticipantType"`,
		Prisma.sql`s."fromParticipantId"`,
	);
	const to = keyOf(
		Prisma.sql`s."toParticipantType"`,
		Prisma.sql`s."toParticipantId"`,
	);
	const parts = dateParts(Prisma.sql`g.date`, k.bounds);
	if (has(f.projectIds)) parts.push(Prisma.sql`g.in_project`);
	if (has(f.people)) parts.push(Prisma.sql`g.other = ANY(${f.people}::text[])`);
	if (has(f.paidBy))
		parts.push(Prisma.sql`g.payer = ANY(${payerKeys(k)}::text[])`);
	const s = searchPart(f.q, [Prisma.sql`g.words`], [Prisma.sql`g.amount`]);
	if (s) parts.push(s);
	if (k.only) parts.push(Prisma.sql`g.key = ${k.only.id}`);
	const pg = pageOf("g", Prisma.sql`g.date`, Prisma.sql`g.key`, page);
	if (pg.where) parts.push(pg.where);
	return Prisma.sql`(SELECT 'g'::text AS src, g.key AS id, g.date AS date FROM (
		SELECT coalesce(s."paymentGroupId", s.id) || '|' || s.currency AS key,
			min(s."initiatedAt") AS date,
			sum(s.amount) AS amount,
			bool_or(coalesce(s."projectId" = ANY(${f.projectIds ?? []}::text[]), false)) AS in_project,
			min(CASE WHEN ${from} = ${me} THEN ${to} ELSE ${from} END) AS other,
			min(${from}) AS payer,
			coalesce(min(s.note), '') || ' ' || coalesce(min(s."paymentMethod"), '') AS words
		FROM settlement s
		WHERE ${PAYMENT_ROW}
			AND (${from} = ${me} OR ${to} = ${me})
		GROUP BY 1
		HAVING NOT bool_and(coalesce(s."projectId" = ANY(${k.excludedProjectIds}::text[]), false))
	) g WHERE ${all(parts)} ${pg.tail})`;
}

/** The branches, each already cut to the page when `page` is given. */
function union(k: KeyQuery, page?: Page): Prisma.Sql | null {
	const w = k.only
		? {
				personal: k.only.src === "p",
				shared: k.only.src === "s",
				payment: k.only.src === "g",
			}
		: wants(k.filter);
	const parts: Prisma.Sql[] = [];
	if (w.personal) parts.push(personal(k, page));
	if (w.shared) parts.push(shared(k, page));
	if (w.payment) parts.push(payments(k, page));
	return parts.length ? Prisma.join(parts, " UNION ALL ") : null;
}

/**
 * One page of row keys after `after`, newest first. Each branch applies the
 * cursor and the limit itself, so Postgres never sorts more than `take` rows
 * per source; the outer sort merges them.
 */
export async function pageKeys(
	db: Db,
	k: KeyQuery,
	after: CursorKey | null,
	take: number,
): Promise<RowKey[]> {
	const u = union(k, { after, take });
	if (!u) return [];
	return db.$queryRaw<RowKey[]>`SELECT u.src, u.id, u.date FROM (${u}) u
		ORDER BY u.date DESC, u.src DESC, u.id DESC LIMIT ${take}`;
}

/** How many rows the filter matches across every page. */
export async function countKeys(db: Db, k: KeyQuery): Promise<number> {
	const u = union(k);
	if (!u) return 0;
	const [row] = await db.$queryRaw<
		{ n: number }[]
	>`SELECT count(*)::int AS n FROM (${u}) u`;
	return row?.n ?? 0;
}
