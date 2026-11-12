/**
 * The pieces of the Activity key queries: the query's types and the WHERE
 * parts of each source, SQL text search included (personal
 * expenses, your shares, payments). query.ts builds the SQL page from them,
 * search-scan.ts the candidate rows of an app-layer text search.
 */

import { Prisma } from "~prisma";
import { amountCandidates, FOLD_FROM, FOLD_TO, likePattern } from "./search";
import type { ActivityKind, ListV2Filter } from "./types";
import { NO_CATEGORY } from "./types";

export type ListBounds = { gte?: Date; lt?: Date };

export type KeyQuery = {
	userId: string;
	filter: ListV2Filter;
	bounds: ListBounds;
	/** Projects you hide from analytics; today's list leaves them out too. */
	excludedProjectIds: string[];
	/** One row only, by its source and key (GET /expenses/row). */
	only?: { src: RowKey["src"]; id: string };
	/**
	 * Set when the text search ran in the app layer (search-scan.ts): every
	 * key it matched, newest first. The path is picked once per request
	 * (index.ts), and these parts read only this, never the epoch, so a flip
	 * mid-request cannot drop the text filter.
	 */
	matched?: RowKey[];
};

/** `created` breaks ties inside a date: the entry added last comes first. */
export type RowKey = {
	src: "p" | "s" | "g";
	id: string;
	date: Date;
	created: Date;
};

export const all = (parts: Prisma.Sql[]) =>
	parts.length ? Prisma.join(parts, " AND ") : Prisma.sql`TRUE`;

export function dateParts(col: Prisma.Sql, b: ListBounds): Prisma.Sql[] {
	const out: Prisma.Sql[] = [];
	if (b.gte) out.push(Prisma.sql`${col} >= ${b.gte}`);
	if (b.lt) out.push(Prisma.sql`${col} < ${b.lt}`);
	return out;
}

export const has = (list?: readonly unknown[]) => !!list && list.length > 0;

const fold = (col: Prisma.Sql) =>
	Prisma.sql`lower(translate(${col}, ${FOLD_FROM}, ${FOLD_TO}))`;

/** The text a search matches in SQL: none when blank or matched in the app. */
const sqlSearch = (k: KeyQuery) =>
	k.matched ? undefined : k.filter.q?.trim() ? k.filter.q : undefined;

/**
 * The SQL path of a text search: text columns that fold-match, or an amount
 * equal to a typed number. Null when there is no search, and also when it ran
 * in the app layer (`matched`): the text may be ciphertext there.
 */
function sqlSearchPart(
	k: KeyQuery,
	texts: Prisma.Sql[],
	amounts: Prisma.Sql[],
): Prisma.Sql | null {
	const q = sqlSearch(k);
	if (!q) return null;
	const pattern = likePattern(q);
	const nums = amountCandidates(q);
	const ors = texts.map((t) => Prisma.sql`${fold(t)} LIKE ${pattern}`);
	if (nums.length)
		for (const a of amounts)
			ors.push(Prisma.sql`${a} = ANY(${nums}::numeric[])`);
	return Prisma.sql`(${Prisma.join(ors, " OR ")})`;
}

/** Personal entry kinds a Type pick lists; reimbursements have no rows yet (2D). */
export const PERSONAL_KIND_SQL: Partial<Record<ActivityKind, Prisma.Sql>> = {
	expense: Prisma.sql`(e.direction = 'OUT' AND e."entryKind" = 'STANDARD')`,
	in: Prisma.sql`(e.direction = 'IN' AND e."entryKind" = 'STANDARD' AND e."inType" IS DISTINCT FROM 'REFUND')`,
	refund: Prisma.sql`(e.direction = 'IN' AND e."entryKind" = 'STANDARD' AND e."inType" = 'REFUND')`,
	transfer: Prisma.sql`e."entryKind" = 'NOT_SPENDING'`,
};

/**
 * The category filter on `col`: the picked ids, and with NO_CATEGORY the
 * rows `none` says have no category.
 */
export function categoryPart(
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
export const PERSONAL_NONE = Prisma.sql`(e."categoryId" IS NULL AND e."entryKind" = 'STANDARD' AND (e.direction = 'OUT' OR e."inType" = 'REFUND'))`;

/**
 * A share with no category as spent() counts it: the expense has none, or
 * its category is another person's (their categories cannot be used here,
 * D19), so Insights' No category and this filter name the same rows.
 */
export const sharedNone = (userId: string) =>
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

export function wants(f: ListV2Filter) {
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

export function personalParts(k: KeyQuery): Prisma.Sql[] {
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
	const text = sqlSearchPart(
		k,
		[
			Prisma.sql`e.title`,
			Prisma.sql`coalesce(e.description, '')`,
			Prisma.sql`coalesce(e.location, '')`,
		],
		[Prisma.sql`e.amount`],
	);
	if (text) parts.push(text);
	if (has(f.currencies))
		parts.push(Prisma.sql`e.currency = ANY(${f.currencies}::text[])`);
	if (k.only) parts.push(Prisma.sql`e.id = ${k.only.id}`);
	return parts;
}

export const keyOf = (type: Prisma.Sql, id: Prisma.Sql) =>
	Prisma.sql`(${type}::text || ':' || ${id})`;

export function payerKeys(k: KeyQuery): string[] {
	return (k.filter.paidBy ?? []).map((p) =>
		p === "me" ? `user:${k.userId}` : p,
	);
}

export function sharedParts(k: KeyQuery): Prisma.Sql[] {
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
	const text = sqlSearchPart(
		k,
		[Prisma.sql`st.description`, Prisma.sql`coalesce(st.notes, '')`],
		[Prisma.sql`st.amount`, Prisma.sql`sp."shareAmount"`],
	);
	if (text) parts.push(text);
	if (has(f.currencies))
		parts.push(Prisma.sql`st.currency = ANY(${f.currencies}::text[])`);
	if (k.only) parts.push(Prisma.sql`st.id = ${k.only.id}`);
	return parts;
}

/** Your own split row on the expense: the shares branch only lists these. */
export const SHARED_JOIN = (
	userId: string,
) => Prisma.sql`FROM shared_transaction st
		JOIN split_participant sp ON sp."transactionId" = st.id
			AND sp."participantType" = 'user' AND sp."participantId" = ${userId}`;

/** Settlement rows that are cash moving: no offsets, forgives or rejected ones. */
export const PAYMENT_ROW = Prisma.sql`s."isOffset" = false AND s.kind = 'PAYMENT' AND s.status <> 'REJECTED'`;

/**
 * One row per payment (MONEY-MOVES I4): the settlement rows of a payment
 * group in one currency. Offsets and forgiven balances move no cash, so they
 * are left out; a payment wholly inside projects you hide is left out like
 * their expenses. `extra` adds select columns (a search needs the row ids).
 */
export function paymentGroups(k: KeyQuery, extra: Prisma.Sql): Prisma.Sql {
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
	// The SQL path matches note and method as one string; the app-layer path
	// reads them itself (they may be ciphertext).
	const words = sqlSearch(k)
		? Prisma.sql`,
			coalesce(min(s.note), '') || ' ' || coalesce(min(s."paymentMethod"), '') AS words`
		: Prisma.empty;
	return Prisma.sql`(
		SELECT coalesce(s."paymentGroupId", s.id) || '|' || s.currency AS key,
			min(s.currency) AS currency,
			min(s."initiatedAt") AS date,
			sum(s.amount) AS amount,
			bool_or(coalesce(s."projectId" = ANY(${f.projectIds ?? []}::text[]), false)) AS in_project,
			min(CASE WHEN ${from} = ${me} THEN ${to} ELSE ${from} END) AS other,
			min(${from}) AS payer${words}${extra}
		FROM settlement s
		WHERE ${PAYMENT_ROW}
			AND (${from} = ${me} OR ${to} = ${me})
		GROUP BY 1
		HAVING NOT bool_and(coalesce(s."projectId" = ANY(${k.excludedProjectIds}::text[]), false))
	) g`;
}

export function paymentParts(k: KeyQuery): Prisma.Sql[] {
	const f = k.filter;
	const parts = dateParts(Prisma.sql`g.date`, k.bounds);
	if (has(f.projectIds)) parts.push(Prisma.sql`g.in_project`);
	if (has(f.currencies))
		parts.push(Prisma.sql`g.currency = ANY(${f.currencies}::text[])`);
	if (has(f.people)) parts.push(Prisma.sql`g.other = ANY(${f.people}::text[])`);
	if (has(f.paidBy))
		parts.push(Prisma.sql`g.payer = ANY(${payerKeys(k)}::text[])`);
	const text = sqlSearchPart(k, [Prisma.sql`g.words`], [Prisma.sql`g.amount`]);
	if (text) parts.push(text);
	if (k.only) parts.push(Prisma.sql`g.key = ${k.only.id}`);
	return parts;
}

/** Which sources a query reads. */
export function sources(k: KeyQuery) {
	return k.only
		? {
				personal: k.only.src === "p",
				shared: k.only.src === "s",
				payment: k.only.src === "g",
			}
		: wants(k.filter);
}
