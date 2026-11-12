/**
 * The app-layer path of the Activity text search, taken once the field
 * encryption epoch exists (`searchesInAppLoaded`, decided once per request in
 * index.ts): titles, descriptions and notes may be ciphertext, which Postgres
 * cannot match. Each source is scanned newest first by the page's own key, in
 * batches (scan-batches.ts), over every row: SQL picks the rows by every other
 * filter and says which typed amounts hit, model reads open the text by id
 * (each cell with its own key), and the match runs here. listActivity runs it
 * before its main transaction and hands the keys over as `KeyQuery.matched`.
 * The SQL path matches with `lower(translate(col, FOLD_FROM, FOLD_TO)) LIKE
 * '%q%'`; foldColumn is that.
 */
import { Prisma } from "~prisma";
import { readInChunks, type ScanClient, scanBatches } from "../scan-batches";
import { type Page, pageOf } from "./query";
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
	byKeyDesc,
	type CursorKey,
	foldColumn,
	foldText,
} from "./search";

type Tx = Prisma.TransactionClient;

/** A row of a source: its key, whether a typed amount hits, and the rows its text is on. */
type Candidate = RowKey & { ids: string[]; amountHit: boolean };

type Texts = { id: string; texts: string[] };

type Search = { needle: string; amounts: string[] };

/** Whether `col` equals any amount a typed number can mean. */
function amountHit(cols: Prisma.Sql[], amounts: string[]): Prisma.Sql {
	if (!amounts.length) return Prisma.sql`false`;
	return Prisma.sql`(${Prisma.join(
		cols.map((c) => Prisma.sql`${c} = ANY(${amounts}::numeric[])`),
		" OR ",
	)})`;
}

const cut = (parts: Prisma.Sql[], where: Prisma.Sql | null) =>
	all(where ? [...parts, where] : parts);

/**
 * Per source: one batch of candidates (no text column), and the text of the
 * rows they name, read through the model so it is opened. A payment's words
 * are per settlement row, its note, a space and its method, as the SQL path
 * builds them from min(note) and min(method), so every payment the SQL path
 * matches is matched here too.
 */
const SOURCES = {
	personal: {
		candidates(k: KeyQuery, page: Page, amounts: string[]) {
			const pg = pageOf(
				"p",
				Prisma.sql`e.date`,
				Prisma.sql`e."createdAt"`,
				Prisma.sql`e.id`,
				page,
			);
			return Prisma.sql`
				SELECT 'p'::text AS src, e.id AS id, e.date AS date, e."createdAt" AS created,
					ARRAY[e.id] AS ids, ${amountHit([Prisma.sql`e.amount`], amounts)} AS "amountHit"
				FROM expense e WHERE ${cut(personalParts(k), pg.where)} ${pg.tail}`;
		},
		async texts(tx: Tx, userId: string, ids: string[]): Promise<Texts[]> {
			const rows = await tx.expense.findMany({
				where: { id: { in: ids }, userId },
				select: { id: true, title: true, description: true, location: true },
			});
			return rows.map((e) => ({
				id: e.id,
				texts: [e.title, e.description ?? "", e.location ?? ""],
			}));
		},
	},
	shared: {
		candidates(k: KeyQuery, page: Page, amounts: string[]) {
			const pg = pageOf(
				"s",
				Prisma.sql`st.date`,
				Prisma.sql`st."createdAt"`,
				Prisma.sql`st.id`,
				page,
			);
			return Prisma.sql`
				SELECT 's'::text AS src, st.id AS id, st.date AS date, st."createdAt" AS created,
					ARRAY[st.id] AS ids,
					${amountHit([Prisma.sql`st.amount`, Prisma.sql`sp."shareAmount"`], amounts)} AS "amountHit"
				${SHARED_JOIN(k.userId)}
				WHERE ${cut(sharedParts(k), pg.where)} ${pg.tail}`;
		},
		async texts(tx: Tx, _userId: string, ids: string[]): Promise<Texts[]> {
			const rows = await tx.sharedTransaction.findMany({
				where: { id: { in: ids } },
				select: { id: true, description: true, notes: true },
			});
			return rows.map((t) => ({
				id: t.id,
				texts: [t.description, t.notes ?? ""],
			}));
		},
	},
	payment: {
		candidates(k: KeyQuery, page: Page, amounts: string[]) {
			const pg = pageOf(
				"g",
				Prisma.sql`g.date`,
				Prisma.sql`g.date`,
				Prisma.sql`g.key`,
				page,
			);
			return Prisma.sql`
				SELECT 'g'::text AS src, g.key AS id, g.date AS date, g.date AS created,
					g.ids, ${amountHit([Prisma.sql`g.amount`], amounts)} AS "amountHit"
				FROM ${paymentGroups(k, Prisma.sql`, array_agg(s.id ORDER BY s.id) AS ids`)}
				WHERE ${cut(paymentParts(k), pg.where)} ${pg.tail}`;
		},
		async texts(tx: Tx, _userId: string, ids: string[]): Promise<Texts[]> {
			const rows = await tx.settlement.findMany({
				where: { id: { in: ids } },
				select: { id: true, note: true, paymentMethod: true },
			});
			return rows.map((s) => ({
				id: s.id,
				texts: [`${s.note ?? ""} ${s.paymentMethod ?? ""}`],
			}));
		},
	},
};

type SourceName = keyof typeof SOURCES;

/**
 * One source's matches after `start`, newest first, until `stop` of them.
 * Payments re-aggregate the caller's settlements for every batch; a person
 * has hundreds to low thousands of them, so that is one or two batches. A row
 * read twice (its date edited between batches) counts once.
 */
async function scanSource(
	db: ScanClient,
	k: KeyQuery,
	name: SourceName,
	search: Search,
	scan: { start: CursorKey | null; stop: number; batch?: number },
): Promise<RowKey[]> {
	const source = SOURCES[name];
	const found = new Map<string, RowKey>();
	await scanBatches(db, k.userId, {
		batch: scan.batch,
		start: scan.start,
		read: async (tx, after, take) => {
			const rows = await tx.$queryRaw<Candidate[]>(
				source.candidates(k, { after, take }, search.amounts),
			);
			const unread = rows.flatMap((r) => (r.amountHit ? [] : r.ids));
			const texts = new Map(
				(
					await readInChunks(unread, take, (ids) =>
						source.texts(tx, k.userId, ids),
					)
				).map((t) => [t.id, t.texts]),
			);
			return rows.map(({ ids, amountHit, ...key }) => ({
				key,
				hit:
					amountHit ||
					ids.some((id) =>
						texts.get(id)?.some((t) => foldColumn(t).includes(search.needle)),
					),
			}));
		},
		cursorOf: (row) => row.key,
		visit: (rows) => {
			for (const { key, hit } of rows)
				if (hit && !found.has(key.id)) found.set(key.id, key);
			return found.size >= scan.stop;
		},
	});
	return [...found.values()];
}

/**
 * The wanted sources with the query's text taken out of the SQL (every other
 * filter stays there), and what the text search looks for.
 */
function prepare(k: KeyQuery) {
	const q = k.filter.q?.trim() ?? "";
	const w = sources(k);
	return {
		plain: { ...k, filter: { ...k.filter, q: undefined } },
		search: { needle: foldText(q), amounts: amountCandidates(q) },
		names: (Object.keys(SOURCES) as SourceName[]).filter((name) => w[name]),
	};
}

/**
 * Every key the search matches after `after`, newest first, with at least
 * the first `stop` of each source: the top N of the union lie in the top N
 * of each source. One source after another, so a request holds one
 * connection at a time.
 */
export async function scanKeys(
	db: ScanClient,
	k: KeyQuery,
	scan: { after: CursorKey | null; stop: number; batch?: number },
): Promise<RowKey[]> {
	const { plain, search, names } = prepare(k);
	const keys: RowKey[] = [];
	for (const name of names)
		keys.push(
			...(await scanSource(db, plain, name, search, {
				start: scan.after,
				stop: scan.stop,
				batch: scan.batch,
			})),
		);
	return keys.sort(byKeyDesc);
}

/** Whether the search matches anything at all; stops at the first match. */
export async function scanAny(
	db: ScanClient,
	k: KeyQuery,
	batch?: number,
): Promise<boolean> {
	const { plain, search, names } = prepare(k);
	for (const name of names) {
		const hits = await scanSource(db, plain, name, search, {
			start: null,
			stop: 1,
			batch,
		});
		if (hits.length) return true;
	}
	return false;
}
