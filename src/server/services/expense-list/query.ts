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
import type { ListV2Filter } from "./types";

type Db = Prisma.TransactionClient;

export type ListBounds = { gte?: Date; lt?: Date };

export type KeyQuery = {
	userId: string;
	filter: ListV2Filter;
	bounds: ListBounds;
	/** Projects you hide from analytics; today's list leaves them out too. */
	excludedProjectIds: string[];
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

function wants(f: ListV2Filter) {
	const kinds = f.kinds ?? [];
	const expense = !kinds.length || kinds.includes("expense");
	const payment = !kinds.length || kinds.includes("payment");
	return {
		personal:
			expense &&
			!has(f.people) &&
			!has(f.projectIds) &&
			(!has(f.paidBy) || !!f.paidBy?.includes("me")),
		shared: expense,
		payment: payment && !has(f.categoryIds),
	};
}

function personal(k: KeyQuery): Prisma.Sql {
	const f = k.filter;
	const parts = [
		Prisma.sql`e."userId" = ${k.userId}`,
		Prisma.sql`e.status = 'FINALIZED'`,
		Prisma.sql`e."isAmortizedChild" = false`,
		...dateParts(Prisma.sql`e.date`, k.bounds),
	];
	if (has(f.categoryIds))
		parts.push(Prisma.sql`e."categoryId" = ANY(${f.categoryIds}::text[])`);
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
	return Prisma.sql`SELECT 'p'::text AS src, e.id AS id, e.date AS date FROM expense e WHERE ${all(parts)}`;
}

const keyOf = (type: Prisma.Sql, id: Prisma.Sql) =>
	Prisma.sql`(${type}::text || ':' || ${id})`;

function payerKeys(k: KeyQuery): string[] {
	return (k.filter.paidBy ?? []).map((p) =>
		p === "me" ? `user:${k.userId}` : p,
	);
}

function shared(k: KeyQuery): Prisma.Sql {
	const f = k.filter;
	const parts = [
		Prisma.sql`(st."projectId" IS NULL OR NOT (st."projectId" = ANY(${k.excludedProjectIds}::text[])))`,
		...dateParts(Prisma.sql`st.date`, k.bounds),
	];
	if (has(f.categoryIds))
		parts.push(Prisma.sql`st."categoryId" = ANY(${f.categoryIds}::text[])`);
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
	return Prisma.sql`SELECT 's'::text AS src, st.id AS id, st.date AS date
		FROM shared_transaction st
		JOIN split_participant sp ON sp."transactionId" = st.id
			AND sp."participantType" = 'user' AND sp."participantId" = ${k.userId}
		WHERE ${all(parts)}`;
}

/**
 * One row per payment (MONEY-MOVES I4): the settlement rows of a payment
 * group in one currency, offsets left out (they move no cash).
 */
function payments(k: KeyQuery): Prisma.Sql {
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
	return Prisma.sql`SELECT 'g'::text AS src, g.key AS id, g.date AS date FROM (
		SELECT coalesce(s."paymentGroupId", s.id) || '|' || s.currency AS key,
			min(s."initiatedAt") AS date,
			sum(s.amount) AS amount,
			bool_or(coalesce(s."projectId" = ANY(${f.projectIds ?? []}::text[]), false)) AS in_project,
			min(CASE WHEN ${from} = ${me} THEN ${to} ELSE ${from} END) AS other,
			min(${from}) AS payer,
			coalesce(min(s.note), '') || ' ' || coalesce(min(s."paymentMethod"), '') AS words
		FROM settlement s
		WHERE s."isOffset" = false AND s.status <> 'REJECTED'
			AND (${from} = ${me} OR ${to} = ${me})
		GROUP BY 1
	) g WHERE ${all(parts)}`;
}

function union(k: KeyQuery): Prisma.Sql | null {
	const w = wants(k.filter);
	const parts: Prisma.Sql[] = [];
	if (w.personal) parts.push(personal(k));
	if (w.shared) parts.push(shared(k));
	if (w.payment) parts.push(payments(k));
	return parts.length ? Prisma.join(parts, " UNION ALL ") : null;
}

/** One page of row keys after `after`, newest first. */
export async function pageKeys(
	db: Db,
	k: KeyQuery,
	after: CursorKey | null,
	take: number,
): Promise<RowKey[]> {
	const u = union(k);
	if (!u) return [];
	const cursor = after
		? Prisma.sql`WHERE (u.date, u.src, u.id) < (${after.date}, ${after.src}, ${after.id})`
		: Prisma.empty;
	return db.$queryRaw<
		RowKey[]
	>`SELECT u.src, u.id, u.date FROM (${u}) u ${cursor}
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
