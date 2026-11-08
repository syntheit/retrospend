/**
 * Text search for the Activity keys, in the app layer. Titles, descriptions
 * and notes may be ciphertext, which Postgres cannot match. A search reads
 * candidate rows with every other filter applied in SQL (one query per
 * source, the newest SEARCH_CANDIDATE_CAP each), reads the text through
 * readUserText and matches it here, then query.ts cuts the cursor and the
 * page from the matches. The old SQL matched with
 * `lower(translate(col, FOLD_FROM, FOLD_TO)) LIKE '%q%'`; foldColumn is that.
 */
import type { Keyring } from "~/server/crypto/field-crypto";
import { Prisma } from "~prisma";
import { readUserText } from "../search-fold";
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
import {
	amountCandidates,
	type CursorKey,
	foldColumn,
	foldText,
} from "./search";

type Db = Prisma.TransactionClient;

/**
 * What a search looks for: the folded text, and the numbers a typed amount
 * can mean. Null when there is no search (blank counts as none).
 */
export function searchOf(
	k: KeyQuery,
): { needle: string; amounts: string[] } | null {
	const q = k.filter.q?.trim();
	if (!q) return null;
	return { needle: foldText(q), amounts: amountCandidates(q) };
}

/** Whether `col` equals any amount a typed number can mean. */
function amountHit(cols: Prisma.Sql[], amounts: string[]): Prisma.Sql {
	if (!amounts.length) return Prisma.sql`false`;
	return Prisma.sql`(${Prisma.join(
		cols.map((c) => Prisma.sql`${c} = ANY(${amounts}::numeric[])`),
		" OR ",
	)})`;
}

/**
 * How many rows of each source a text search reads: the newest ones that pass
 * every other filter. Rows beyond that are not searched, so someone with more
 * than this many expenses (or shares, or payments) in the filtered range
 * finds only the newest. A date filter narrows the window.
 */
export const SEARCH_CANDIDATE_CAP = 20_000;

type Candidate = RowKey & {
	/** The text columns to match, in the order of the column list for the source. */
	texts: (string | null)[];
	amountHit: boolean;
};

type PaymentCandidate = RowKey & {
	ids: string[];
	notes: (string | null)[];
	method: string | null;
	amountHit: boolean;
};

const newestFirst = (
	k: KeyQuery,
	date: Prisma.Sql,
	created: Prisma.Sql,
	id: Prisma.Sql,
) =>
	Prisma.sql`ORDER BY ${date} DESC, ${created} DESC, ${id} DESC LIMIT ${k.candidateCap ?? SEARCH_CANDIDATE_CAP}`;

const personalColumns = ["title", "description", "location"] as const;
const sharedColumns = ["description", "notes"] as const;

/** A search's candidates from each wanted source, with their text still unread. */
async function candidates(db: Db, k: KeyQuery, amounts: string[]) {
	const w = sources(k);
	const rows = {
		personal: [] as Candidate[],
		shared: [] as Candidate[],
		payment: [] as PaymentCandidate[],
	};
	// One at a time: a transaction runs one query at once.
	if (w.personal)
		rows.personal = await db.$queryRaw<Candidate[]>`
			SELECT 'p'::text AS src, e.id AS id, e.date AS date, e."createdAt" AS created,
				ARRAY[e.title::text, e.description::text, e.location::text] AS texts,
				${amountHit([Prisma.sql`e.amount`], amounts)} AS "amountHit"
			FROM expense e WHERE ${all(personalParts(k))}
			${newestFirst(k, Prisma.sql`e.date`, Prisma.sql`e."createdAt"`, Prisma.sql`e.id`)}`;
	if (w.shared)
		rows.shared = await db.$queryRaw<Candidate[]>`
			SELECT 's'::text AS src, st.id AS id, st.date AS date, st."createdAt" AS created,
				ARRAY[st.description::text, st.notes::text] AS texts,
				${amountHit([Prisma.sql`st.amount`, Prisma.sql`sp."shareAmount"`], amounts)} AS "amountHit"
			${SHARED_JOIN(k.userId)}
			WHERE ${all(sharedParts(k))}
			${newestFirst(k, Prisma.sql`st.date`, Prisma.sql`st."createdAt"`, Prisma.sql`st.id`)}`;
	if (w.payment)
		rows.payment = await db.$queryRaw<PaymentCandidate[]>`
			SELECT 'g'::text AS src, g.key AS id, g.date AS date, g.date AS created,
				g.ids, g.notes, g.method,
				${amountHit([Prisma.sql`g.amount`], amounts)} AS "amountHit"
			FROM ${paymentGroups(
				k,
				Prisma.sql`,
					array_agg(s.id ORDER BY s.id) AS ids,
					array_agg(s.note::text ORDER BY s.id) AS notes,
					min(s."paymentMethod") AS method`,
			)}
			WHERE ${all(paymentParts(k))}
			${newestFirst(k, Prisma.sql`g.date`, Prisma.sql`g.date`, Prisma.sql`g.key`)}`;
	return rows;
}

/** A payment's words as the old SQL built them: its note, a space, its method. */
function paymentWords(c: PaymentCandidate, keyring: Keyring | undefined) {
	const notes = c.notes.flatMap((note, i) =>
		note === null
			? []
			: [
					readUserText(keyring, note, {
						table: "settlement",
						column: "note",
						rowId: c.ids[i] ?? "",
					}),
				],
	);
	// Every row of a payment carries the same note; none means an empty one.
	return (notes.length ? notes : [""]).map((n) => `${n} ${c.method ?? ""}`);
}

/** Descending by the page's sort key; the same order the cursor is read in. */
export function byKeyDesc(a: CursorKey, b: CursorKey): number {
	return (
		b.date.getTime() - a.date.getTime() ||
		b.created.getTime() - a.created.getTime() ||
		(a.src === b.src ? 0 : a.src < b.src ? 1 : -1) ||
		(a.id === b.id ? 0 : a.id < b.id ? 1 : -1)
	);
}

/** Every key a search matches, newest first. Memoized per query object. */
const searchMemo = new WeakMap<KeyQuery, Promise<RowKey[]>>();

export function searchKeys(
	db: Db,
	k: KeyQuery,
	search: { needle: string; amounts: string[] },
): Promise<RowKey[]> {
	let found = searchMemo.get(k);
	if (!found) {
		found = (async () => {
			const rows = await candidates(db, k, search.amounts);
			const anyMatch = (texts: string[]) =>
				texts.some((t) => foldColumn(t).includes(search.needle));
			const column =
				(table: string, id: string, columns: readonly string[]) =>
				(value: string | null, i: number) =>
					readUserText(k.keyring, value, {
						table,
						column: columns[i] ?? "",
						rowId: id,
					});
			const keep = [
				...rows.personal.filter(
					(c) =>
						c.amountHit ||
						anyMatch(c.texts.map(column("expense", c.id, personalColumns))),
				),
				...rows.shared.filter(
					(c) =>
						c.amountHit ||
						anyMatch(
							c.texts.map(column("shared_transaction", c.id, sharedColumns)),
						),
				),
				...rows.payment.filter(
					(c) => c.amountHit || anyMatch(paymentWords(c, k.keyring)),
				),
			];
			return keep
				.map(({ src, id, date, created }) => ({ src, id, date, created }))
				.sort(byKeyDesc);
		})();
		searchMemo.set(k, found);
	}
	return found;
}
