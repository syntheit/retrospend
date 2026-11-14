/**
 * The budget block of GET /sync/shares (E2EE P13b): what a device needs to
 * read the budget figures the way the server does, from the caller's own
 * rows plus this block. It rides on the shares snapshot so the owed totals
 * and the splits come from one database snapshot.
 *
 * Two transactions per pull, because a read-only snapshot cannot freeze the
 * values it valued (a foreign row is valued at the rate of the day it is first
 * read and then kept, valuer.ts):
 *
 * - tx1 (freezeForDevice, default isolation) is the same read the budget
 *   figures make, so it freezes and marks stale exactly what a page or a
 *   registry read would. A device pull counts as that first read.
 * - tx2 (readBudgetBlock, inside the repeatable-read read-only snapshot of the
 *   shares) loads the book again and writes nothing. When it still has a value
 *   it would freeze, a row came in or a rate day turned between the two, and
 *   the caller runs tx1 once more and retries; a second miss answers the budget
 *   as unavailable (the device must never value a row the server has not kept).
 *
 * The gap that remains until frozen values move to the device (K9): a device
 * that values a row itself before its next pull, across a rate rewrite (the
 * daily sync moves a rate row in place, 09:05 UTC) or on stale cached rates,
 * can read a value the server has not frozen yet. The pull's own check cannot
 * see rows the device alone holds; parity names those newer than `asOf`.
 *
 * Nothing here reads a title, a note or another person's identity: counterparties
 * and everyone else's ids are opaque keys (domain split-block.ts), and the
 * frozen values are only those of the caller's own expenses.
 */
import { bookValuationKey } from "@retrospend/domain/envelope/book-valuation-key";
import { loadBookFrom } from "@retrospend/domain/envelope/load-book";
import {
	type SplitBlock,
	splitBlockOf,
} from "@retrospend/domain/envelope/split-block";
import type { db as globalDb } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import { prismaBookSource } from "~/server/services/envelope/inputs";
import {
	forgetMonthViews,
	monthViewIn,
} from "~/server/services/envelope/month-read";
import { planCostIn } from "~/server/services/envelope/plan-read";
import { Prisma } from "~prisma";
import { soloBook } from "./book-entities";
import { readCutCursor } from "./changes";

type Tx = Prisma.TransactionClient;

export interface BudgetBlock {
	bookId: string;
	/** What the book's valuations depend on (domain bookValuationKey): a device reads the figures only while it matches its own. */
	valuationKey: string;
	/** The sync cursor this block is exact at: usable once every cursor the device holds has reached it. */
	asOf: string;
	/** Values of the caller's own expenses frozen on the server, by their key. */
	frozen: Array<{ key: string; minor: number; approximate: boolean }>;
	splits: SplitBlock;
}

/** No book to read (Just track, a book others share, none with a default envelope), a block, or one that failed. */
export type BudgetRead =
	| { kind: "none" }
	| { kind: "unavailable" }
	| { kind: "block"; block: BudgetBlock; unfrozen: number };

/**
 * tx1: reads the budget the way the figures do, so what a read freezes or
 * marks stale is done before the snapshot. False when there is no personal
 * book of the caller's alone to read.
 */
export async function freezeForDevice(
	tx: Tx,
	userId: string,
	now: Date,
): Promise<boolean> {
	const book = await tx.budgetBook.findFirst({
		where: soloBook(userId),
		select: { defaultEnvelopeId: true },
	});
	if (!book?.defaultEnvelopeId) return false;
	forgetMonthViews(tx);
	// The month view freezes its own rows and shares; the plan cost reads the
	// closed months' income and the spending before the book, which freeze too.
	if (!(await monthViewIn(tx, userId, now))) return false;
	await planCostIn(tx, userId, {}, now);
	return true;
}

/**
 * The entities whose stamps say a row a valuation reads may have changed.
 * Shares, settlements and rates have no stamp: tx2's own check of what is
 * still unfrozen covers them, so skipping tx1 on a quiet log is safe.
 */
const SIGNAL_ENTITIES = [
	"expense",
	"budget_book",
	"book_period",
	"asset_account",
	"recurring_template",
];

/** The newest visible stamp of each of those entities for the caller, as one string. */
async function stampSignal(tx: Tx, userId: string): Promise<string> {
	const rows = await tx.$queryRaw<{ stamp: string | null }[]>(Prisma.sql`
		SELECT (
			SELECT c."txid"::text || ':' || c."seq"::text
			FROM "sync_change" c
			WHERE c."userId" = ${userId} AND c."entity" = e.entity
			  AND c."txid" < pg_snapshot_xmin(pg_current_snapshot())
			ORDER BY c."txid" DESC, c."seq" DESC
			LIMIT 1
		) AS "stamp"
		FROM unnest(${SIGNAL_ENTITIES}::text[]) WITH ORDINALITY AS e(entity, n)
		ORDER BY e.n`);
	return rows.map((r) => r.stamp ?? "-").join(",");
}

/** What tx1 last saw per user in this process; a restart only costs one more run. */
const lastRun = new Map<string, string>();
const LAST_RUN_LIMIT = 10_000;

function remember(userId: string, signal: string) {
	lastRun.delete(userId);
	lastRun.set(userId, signal);
	if (lastRun.size > LAST_RUN_LIMIT) {
		const oldest = lastRun.keys().next().value;
		if (oldest !== undefined) lastRun.delete(oldest);
	}
}

/**
 * Runs tx1 for the caller. Unless `force`, it is skipped when no stamp of the
 * entities above arrived since the last run for this user in this process.
 * An error is logged without its text and swallowed: tx2 then finds what is
 * still unfrozen and the retry rule decides, so a failed freeze can never
 * leave a device with a value the server does not hold.
 */
export async function runFreeze(
	db: typeof globalDb,
	userId: string,
	opts: { force?: boolean } = {},
): Promise<void> {
	try {
		const done = await userTransaction(
			db,
			userId,
			async (tx) => {
				const signal = await stampSignal(tx, userId);
				if (!opts.force && lastRun.get(userId) === signal) return null;
				const ran = await freezeForDevice(tx, userId, new Date());
				return ran ? signal : null;
			},
			// A full book read: longer than the default five seconds at 10k rows.
			{ timeout: 30_000 },
		);
		if (done !== null) remember(userId, done);
	} catch (error) {
		console.error(
			"Freezing for a device failed",
			error instanceof Error ? error.name : "unknown",
		);
	}
}

/** The frozen values whose key starts with one of the caller's own expense ids. */
async function ownFrozen(tx: Tx, bookId: string, userId: string) {
	const rows = await tx.$queryRaw<
		{ key: string; minor: bigint; approximate: boolean }[]
	>(Prisma.sql`
		SELECT v."key", v."minor", v."approximate"
		FROM "budget_row_value" v
		WHERE v."bookId" = ${bookId}
		  AND split_part(v."key", '|', 1) IN (
			SELECT x."id" FROM "expense" x WHERE x."userId" = ${userId}
		  )
		ORDER BY v."key"`);
	return rows.map((r) => ({
		key: r.key,
		minor: Number(r.minor),
		approximate: r.approximate,
	}));
}

/** Which of these ids are the caller's own expenses. */
async function ownExpenseIds(
	tx: Tx,
	userId: string,
	ids: string[],
): Promise<Set<string>> {
	if (ids.length === 0) return new Set();
	const rows = await tx.expense.findMany({
		where: { userId, id: { in: ids } },
		select: { id: true },
	});
	return new Set(rows.map((r) => r.id));
}

/**
 * tx2: the block for the caller, in the transaction of the snapshot. Writes
 * nothing; `unfrozen` counts the values the load had to make itself.
 */
export async function readBudgetBlock(
	tx: Tx,
	userId: string,
	now: Date,
): Promise<BudgetRead> {
	const shared = await tx.budgetBook.findFirst({
		where: {
			createdById: userId,
			isPersonal: true,
			members: { some: { userId: { not: userId } } },
		},
		select: { id: true },
	});
	if (shared) return { kind: "none" };
	const load = await loadBookFrom(prismaBookSource(tx, userId), { now });
	if (!load) return { kind: "none" };
	const { loaded } = load;
	const asOf = await readCutCursor(tx);
	const checkpoint = loaded.checkpoint;
	const behind = [
		...(checkpoint?.missingRates ?? []).flatMap((r) =>
			r.rowId ? [r.rowId] : [],
		),
		...(checkpoint?.approximate ?? []).map((r) => r.rowId),
	];
	const block: BudgetBlock = {
		bookId: loaded.row.id,
		valuationKey: bookValuationKey(loaded.row),
		asOf,
		frozen: await ownFrozen(tx, loaded.row.id, userId),
		splits: splitBlockOf(loaded.splits, loaded.shareSide, {
			missingRates: checkpoint?.missingRates ?? [],
			approximate: checkpoint?.approximate ?? [],
			own: await ownExpenseIds(tx, userId, behind),
		}),
	};
	return { kind: "block", block, unfrozen: load.fresh.length };
}
