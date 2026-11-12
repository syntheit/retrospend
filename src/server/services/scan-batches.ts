/**
 * Reads every row a search needs, in keyset batches (E2EE D11 PR 5,
 * docs/roadmap/e2ee-d11-pr5.md section 2). Once text may be sealed, Postgres
 * cannot match it: SQL or a model keyset picks rows by unmapped columns, model
 * reads open the text, and the app matches it. There is no cap: a search reads
 * every row it must.
 *
 * Each batch is its own short userTransaction (the keys and the epoch load
 * before it opens), never one long one: a long transaction holds back the
 * snapshot horizon the event feed reads (events/feed.ts). So no snapshot spans
 * the scan: a row written meanwhile can be missed, and one whose sort columns
 * change can be read twice, so callers dedupe by id. That is fine for search.
 * A batch is also the most rows opened in one go, so the event loop yields
 * between batches.
 */
import { inTransaction, userTransaction } from "~/server/db-tx";
import type { Prisma, PrismaClient } from "~prisma";

export const SCAN_BATCH = 5_000;

export type ScanClient = Pick<PrismaClient, "$transaction">;

export interface Scan<Row, Cursor> {
	/** Rows per batch: SCAN_BATCH unless a test passes a small one. */
	batch?: number;
	/** The cursor to start after; null for the top. */
	start: Cursor | null;
	/** Up to `take` rows after `after`, in keyset order. */
	read(
		tx: Prisma.TransactionClient,
		after: Cursor | null,
		take: number,
	): Promise<Row[]>;
	cursorOf(row: NoInfer<Row>): Cursor;
	/** Keeps what it needs from one batch; true stops the scan. */
	visit(rows: Row[]): boolean;
}

function refuseInTransaction(): void {
	if (inTransaction())
		throw new Error("a scan opens its own transactions; call it outside one");
}

export async function scanBatches<Row, Cursor>(
	db: ScanClient,
	userId: string,
	scan: Scan<Row, Cursor>,
): Promise<void> {
	refuseInTransaction();
	const take = scan.batch ?? SCAN_BATCH;
	let after = scan.start;
	for (;;) {
		const rows = await userTransaction(db, userId, (tx) =>
			scan.read(tx, after, take),
		);
		const last = rows.at(-1);
		if (scan.visit(rows) || rows.length < take || !last) return;
		after = scan.cursorOf(last);
	}
}

/** A row's place in a scan newest first by the unmapped (date, id). */
export type DateId = { date: Date; id: string };

export const dateIdOf = (row: DateId): DateId => ({
	date: row.date,
	id: row.id,
});

/** The rows after `after` in (date desc, id desc) order, as a where clause. */
export function olderThan(after: DateId | null) {
	return after
		? {
				OR: [
					{ date: { lt: after.date } },
					{ date: after.date, id: { lt: after.id } },
				],
			}
		: {};
}

/**
 * Rows picked by id, `size` ids at a time, each chunk its own
 * userTransaction as in scanBatches; `read` keeps only what the caller needs.
 */
export async function scanIds<T>(
	db: ScanClient,
	userId: string,
	ids: readonly string[],
	read: (tx: Prisma.TransactionClient, ids: string[]) => Promise<T[]>,
	size = SCAN_BATCH,
): Promise<T[]> {
	refuseInTransaction();
	return readInChunks(ids, size, (chunk) =>
		userTransaction(db, userId, (tx) => read(tx, chunk)),
	);
}

/** `read` over `ids` in chunks of at most `size`, one query each. */
export async function readInChunks<T>(
	ids: readonly string[],
	size: number,
	read: (ids: string[]) => Promise<T[]>,
): Promise<T[]> {
	const out: T[] = [];
	for (let i = 0; i < ids.length; i += size)
		out.push(...(await read(ids.slice(i, i + size))));
	return out;
}
