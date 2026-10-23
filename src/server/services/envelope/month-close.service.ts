/**
 * Lazy month close (SPEC §5.5, D36): no cron. On the first read on or after
 * day 1 of a month, every open month before it closes, oldest first, under
 * the book's advisory lock, each with its summary (month-close.ts). A Limits
 * book (funding source TARGETS, SPEC §5.6) then opens the month with one
 * PLAN_FUND batch that gives every targeted envelope its need.
 *
 * Both steps start with a cheap existence check and check again under the
 * lock, so concurrent first reads close each month once and fund it once
 * (`month_close` is also unique per book and month). Reads that run it:
 * read.service (READ COMMITTED). Previews and mutations compute the same
 * numbers without it: an unclosed month already uses today's rules.
 */
import { randomUUID } from "node:crypto";
import type { MonthCloseSummary } from "~/lib/schemas/envelope";
import type { Prisma } from "~prisma";
import { addMonths } from "./calendar";
import { computeBook } from "./engine";
import { loadBook } from "./inputs";
import { closeSummary } from "./month-close";
import { forgetMonthViews, monthViewIn } from "./month-read";
import { budgetMonthOf, isoDateIn, monthsFrom } from "./months";
import { lockBook } from "./movement-state";
import { fromMinor } from "./units";

type Tx = Prisma.TransactionClient;

interface BookHead {
	id: string;
	startMonth: number;
	fundingSource: "INCOME" | "TARGETS";
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
	const funded = await tx.budgetMovement.count({
		where: { bookId: b.id, month: b.current, kind: "PLAN_FUND" },
	});
	return funded === 0;
}

async function writeCloses(
	tx: Tx,
	userId: string,
	b: BookHead,
	months: number[],
	now: Date,
): Promise<MonthCloseSummary[]> {
	const loaded = await loadBook(tx, userId, { now });
	if (!loaded) return [];
	const state = computeBook(loaded.input);
	const summaries = months.map((month) =>
		closeSummary({
			input: loaded.input,
			state,
			month,
			currency: b.currency,
			events: loaded.splits.events,
		}),
	);
	await tx.monthClose.createMany({
		data: summaries.map((summary) => ({
			bookId: b.id,
			month: summary.month,
			mode: "AUTO" as const,
			summary,
		})),
		skipDuplicates: true,
	});
	return summaries;
}

/** A Limits month opens with each targeted envelope's need assigned (PLAN_FUND), whatever To assign holds. */
async function planFund(tx: Tx, userId: string, b: BookHead, now: Date) {
	forgetMonthViews(tx);
	const view = await monthViewIn(tx, userId, now);
	if (!view) return 0;
	const batchId = randomUUID();
	const rows = view.dto.groups
		.flatMap((g) => g.envelopes)
		.filter((e) => (e.target?.need.minor ?? 0) > 0)
		.map((e) => ({
			id: randomUUID(),
			bookId: b.id,
			month: b.current,
			fromEnvelopeId: null,
			toEnvelopeId: e.id,
			amount: fromMinor(e.target?.need.minor ?? 0, b.currency).toString(),
			kind: "PLAN_FUND" as const,
			batchId,
			actorUserId: userId,
		}));
	if (rows.length > 0) await tx.budgetMovement.createMany({ data: rows });
	return rows.length;
}

export interface CloseRun {
	closed: number[];
	/** Envelopes a PLAN_FUND batch funded this month (Limits). */
	funded: number;
}

/** Closes every open month before today's and funds a Limits month; a no-op when done. */
export async function ensureMonthsClosed(
	tx: Tx,
	userId: string,
	now: Date,
): Promise<CloseRun> {
	const none: CloseRun = { closed: [], funded: 0 };
	const b = await headOf(tx, userId, now);
	if (!b) return none;
	const quick =
		(await openMonths(tx, b)).length > 0 || (await needsFunding(tx, b));
	if (!quick) return none;
	await lockBook(tx, b.id);
	// Again under the lock: a concurrent first read may have done it.
	const months = await openMonths(tx, b);
	const closed = months.length
		? (await writeCloses(tx, userId, b, months, now)).map((s) => s.month)
		: [];
	const funded = (await needsFunding(tx, b))
		? await planFund(tx, userId, b, now)
		: 0;
	forgetMonthViews(tx);
	return { closed, funded };
}
