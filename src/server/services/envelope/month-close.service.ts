/**
 * Lazy month close (SPEC §5.5, D36): no cron. On the first read on or after
 * day 1 of a month, every open month before it closes, oldest first, under
 * the book's advisory lock, each with its summary (month-close.ts) and
 * checkpoint. Closed months whose rows changed since (budget_dirty marks)
 * are recomputed: updated in place inside the late window, revised after
 * it (month-revise.ts). A Limits book (funding source TARGETS, SPEC §5.6)
 * then opens the month with one PLAN_FUND batch that gives every targeted
 * envelope its need.
 *
 * Every step starts with a cheap existence check and checks again under the
 * lock, so concurrent first reads close each month once and fund it once
 * (`month_close` is also unique per book and month). Reads that run it:
 * read.service (READ COMMITTED). Previews and mutations compute the same
 * numbers without it: an unclosed month already uses today's rules, and a
 * dirty mark sends their pass back to an earlier checkpoint.
 */
import { randomUUID } from "node:crypto";
import type { Prisma } from "~prisma";
import { addMonths } from "./calendar";
import { loadCloseRows, loadDirtyMarks } from "./close-rows";
import { forgetMonthViews, monthViewIn } from "./month-read";
import { closeAndRevise } from "./month-revise";
import { budgetMonthOf, isoDateIn, monthsFrom } from "./months";
import { lockBook } from "./movement-state";
import { fromMinor } from "./units";

type Tx = Prisma.TransactionClient;

interface BookHead {
	id: string;
	startMonth: number;
	fundingSource: "INCOME" | "TARGETS";
	planFundFrom: number | null;
	currency: string;
	current: number;
}

async function headOf(
	tx: Tx,
	userId: string,
	now: Date,
): Promise<BookHead | null> {
	const book = await tx.budgetBook.findFirst({
		where: { createdById: userId, isPersonal: true },
		select: {
			id: true,
			startMonth: true,
			fundingSource: true,
			planFundFrom: true,
			currency: true,
			timeZone: true,
			defaultEnvelopeId: true,
			periods: { select: { fromMonth: true, startDay: true } },
		},
	});
	if (!book?.defaultEnvelopeId) return null;
	const today = isoDateIn(now, book.timeZone);
	return { ...book, current: budgetMonthOf(today, book.periods) };
}

/** Months before the current one that have no close yet, oldest first. */
async function openMonths(tx: Tx, b: BookHead): Promise<number[]> {
	if (b.current <= b.startMonth) return [];
	const due = monthsFrom(b.startMonth, addMonths(b.current, -1));
	const closed = await tx.monthClose.findMany({
		where: { bookId: b.id, month: { in: due } },
		select: { month: true },
	});
	const done = new Set(closed.map((c) => c.month));
	return due.filter((m) => !done.has(m));
}

async function needsFunding(tx: Tx, b: BookHead): Promise<boolean> {
	if (b.fundingSource !== "TARGETS") return false;
	// A switch to Limits funds from the next month on (SPEC §4.4).
	if (b.planFundFrom !== null && b.current < b.planFundFrom) return false;
	const funded = await tx.budgetMovement.count({
		where: { bookId: b.id, month: b.current, kind: "PLAN_FUND" },
	});
	return funded === 0;
}

/** A Limits month opens with each targeted envelope's need assigned (PLAN_FUND), whatever To assign holds. */
export async function planFund(tx: Tx, userId: string, now: Date) {
	forgetMonthViews(tx);
	const view = await monthViewIn(tx, userId, now);
	if (!view) return 0;
	const H = view.dto.book.currency;
	const month = view.dto.month.key;
	const batchId = randomUUID();
	const rows = view.dto.groups
		.flatMap((g) => g.envelopes)
		.filter((e) => (e.target?.need.minor ?? 0) > 0)
		.map((e) => ({
			id: randomUUID(),
			bookId: view.dto.book.id,
			month,
			fromEnvelopeId: null,
			toEnvelopeId: e.id,
			amount: fromMinor(e.target?.need.minor ?? 0, H).toString(),
			kind: "PLAN_FUND" as const,
			batchId,
			actorUserId: userId,
		}));
	if (rows.length > 0) await tx.budgetMovement.createMany({ data: rows });
	forgetMonthViews(tx);
	return rows.length;
}

export interface CloseRun {
	closed: number[];
	/** Closes updated in place inside their late window (C17). */
	late: number[];
	/** Closes given a new revision (C16). */
	revised: number[];
	/** Envelopes a PLAN_FUND batch funded this month (Limits). */
	funded: number;
}

/**
 * The month to recompute closes from: the earliest dirty mark at or before
 * the last close, or the first close without a checkpoint (closes written
 * before checkpoints existed). Null when every close is current.
 */
function reviseFrom(
	closes: Awaited<ReturnType<typeof loadCloseRows>>,
	dirty: Awaited<ReturnType<typeof loadDirtyMarks>>,
): number | null {
	const last = closes.at(-1)?.month;
	if (last === undefined) return null;
	const marks = dirty.map((d) => d.fromMonth).filter((m) => m <= last);
	const bare = closes.filter((c) => !c.checkpoint).map((c) => c.month);
	const all = [...marks, ...bare];
	return all.length ? Math.min(...all) : null;
}

/** Closes every open month before today's, revises changed ones and funds a Limits month; a no-op when done. */
export async function ensureMonthsClosed(
	tx: Tx,
	userId: string,
	now: Date,
): Promise<CloseRun> {
	const none: CloseRun = { closed: [], late: [], revised: [], funded: 0 };
	const b = await headOf(tx, userId, now);
	if (!b) return none;
	const quick =
		(await loadDirtyMarks(tx, b.id)).length > 0 ||
		(await openMonths(tx, b)).length > 0 ||
		(await needsFunding(tx, b));
	if (!quick) return none;
	await lockBook(tx, b.id);
	// Again under the lock: a concurrent first read may have done it.
	const dirty = await loadDirtyMarks(tx, b.id);
	const open = await openMonths(tx, b);
	const closes = await loadCloseRows(tx, b.id);
	const from = reviseFrom(closes, dirty);
	// The late window is judged per change, on when it was made, not when it is read.
	const last = closes.at(-1)?.month ?? 0;
	const changes = dirty.filter((d) => d.fromMonth <= last);
	const run =
		open.length > 0 || from !== null
			? await closeAndRevise(
					tx,
					userId,
					now,
					{ reviseFrom: from, open, changes },
					closes,
				)
			: { closed: [], late: [], revised: [] };
	// Only marks this read saw: one written since covers rows it did not read.
	if (dirty.length > 0)
		await tx.budgetDirty.deleteMany({
			where: { id: { in: dirty.map((d) => d.id) } },
		});
	forgetMonthViews(tx);
	const funded = (await needsFunding(tx, b))
		? await planFund(tx, userId, now)
		: 0;
	return { ...run, funded };
}
