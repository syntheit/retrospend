/**
 * Closing months and keeping closed months honest (SPEC §5.5, B3, B7),
 * under the book's lock (month-close.service.ts calls this):
 *
 * - New closes: each open month before today's gets its summary and its
 *   checkpoint (SPEC §5.13).
 * - Revisions: a budget_dirty mark at or before the last closed month means
 *   a row in a closed month changed. Every close from the mark on is
 *   recomputed. A close whose numbers moved:
 *   - inside its late window (7 days after the month ended, C17) has its
 *     summary updated in place and counts its late entries; no item;
 *   - after the window (C16) gets a new revision and the change's effect on
 *     today's numbers (each envelope's Left and To assign, before and
 *     after), which raises one "Month changed after it closed" item for the
 *     whole change.
 *   Checkpoints from the mark on are rewritten whether or not the numbers
 *   moved.
 *
 * "Today before the change" is the stale checkpoint of the last closed month
 * run forward over today's rows: the rows of the open months are the same
 * on both sides, so the difference is what the closed months changed.
 */
import { randomUUID } from "node:crypto";
import type { MonthCloseSummary } from "~/lib/schemas/envelope";
import type { Prisma } from "~prisma";
import { addDays, addMonths } from "./calendar";
import {
	checkpointAt,
	type StoredCheckpoint,
	summaryDiffers,
	toEngineCheckpoint,
} from "./checkpoint";
import type { CloseRow, Recalc } from "./close-rows";
import { type BookState, computeBook, sumLeft } from "./engine";
import { type LoadedBook, loadBook, monthStartInstant } from "./inputs";
import { approximateThrough, missingThrough } from "./load-state";
import { closeSummary } from "./month-close";
import { isoDateIn, monthRange, startDayFor } from "./months";
import type { MonthKey } from "./types";

type Tx = Prisma.TransactionClient;

/** Days after a month's last day during which changes update its summary in place (C17). */
export const LATE_WINDOW_DAYS = 7;

export interface ReviseRequest {
	/** Recompute closes from this month on (0 = the book's start); null: none. */
	reviseFrom: MonthKey | null;
	/** Months to close, oldest first. */
	open: readonly MonthKey[];
	/** The changes behind the revision (their marks): each is judged against the window on the day it was made. */
	changes?: ReadonlyArray<{ fromMonth: MonthKey; createdAt: Date }>;
}

export interface ReviseResult {
	closed: MonthKey[];
	/** Closes updated in place inside their late window. */
	late: MonthKey[];
	/** Closes given a new revision. */
	revised: MonthKey[];
}

interface Ctx {
	tx: Tx;
	loaded: LoadedBook;
	state: BookState;
	now: Date;
	/** Each change with the book-zone day it was made (none: a backfill, judged today). */
	changes: ReadonlyArray<{ fromMonth: MonthKey; day: string }>;
}

function summaryOf(c: Ctx, month: MonthKey): MonthCloseSummary {
	return closeSummary({
		input: c.loaded.input,
		state: c.state,
		month,
		currency: c.loaded.book.currency,
		events: c.loaded.splits.events,
	});
}

function checkpointOf(c: Ctx, month: MonthKey): StoredCheckpoint {
	return checkpointAt(c.state, month, {
		missingRates: missingThrough(c.loaded, month),
		approximate: approximateThrough(c.loaded, month),
		print: c.loaded.prints.get(month) ?? "",
	});
}

/** Whether a change made on `changedOn` (book-zone day) falls in `month`'s late window. */
export function inLateWindow(
	loaded: LoadedBook,
	month: MonthKey,
	changedOn: string = loaded.today,
): boolean {
	const end = monthRange(month, loaded.periods).to;
	return changedOn <= addDays(end, LATE_WINDOW_DAYS);
}

/**
 * Every change that reached `month` was made inside its late window: then
 * the summary is updated in place. One change after the window means a
 * revision. With no change on record (a backfill), today decides.
 */
function lateOnly(c: Ctx, month: MonthKey): boolean {
	const reached = c.changes.filter((ch) => ch.fromMonth <= month);
	if (reached.length === 0) return inLateWindow(c.loaded, month);
	return reached.every((ch) => inLateWindow(c.loaded, month, ch.day));
}

/**
 * Own rows dated in `month` added after it closed ("Includes 3 late
 * expenses"). Edits are not entries, so a renamed row never counts.
 */
async function lateCount(c: Ctx, row: CloseRow): Promise<number> {
	const zone = c.loaded.row.timeZone;
	const at = (m: MonthKey) =>
		monthStartInstant(m, startDayFor(m, c.loaded.periods), zone);
	return c.tx.expense.count({
		where: {
			userId: c.loaded.row.createdById,
			date: { gte: at(row.month), lt: at(addMonths(row.month, 1)) },
			createdAt: { gt: row.closedAt },
		},
	});
}

/** Today's Left per envelope and To assign, from a given state. */
function today(state: BookState) {
	const c = state.currentMonth;
	const left = new Map<string, number>();
	for (const [id, r] of state.month(c).envelopes) left.set(id, r.left);
	return { left, toAssign: state.toAssign(c).total, total: sumLeft(state, c) };
}

/** The effect on today's numbers of what changed before the stale checkpoint. */
function effectToday(
	c: Ctx,
	stale: StoredCheckpoint | null,
	earliestMonth: MonthKey,
): Recalc | null {
	if (!stale || stale.month >= c.loaded.input.currentMonth) return null;
	const before = today(
		computeBook({ ...c.loaded.input, checkpoint: toEngineCheckpoint(stale) }),
	);
	const after = today(c.state);
	const envelopes = [...after.left]
		.map(([id, v]) => ({ id, delta: v - (before.left.get(id) ?? 0) }))
		.filter((e) => e.delta !== 0);
	return {
		changeId: randomUUID(),
		at: c.now.toISOString(),
		earliestMonth,
		toAssign: after.toAssign - before.toAssign,
		envelopes,
	};
}

async function revise(
	c: Ctx,
	rows: readonly CloseRow[],
	from: MonthKey,
): Promise<Pick<ReviseResult, "late" | "revised">> {
	const due = rows.filter((r) => r.month >= from);
	const changed = due.map((r) => {
		const next = summaryOf(c, r.month);
		return { r, next, moved: summaryDiffers(r.summary, next) };
	});
	const after = changed.filter((x) => x.moved && !lateOnly(c, x.r.month));
	const recalc =
		after.length > 0
			? effectToday(
					c,
					rows.at(-1)?.checkpoint ?? null,
					after[0]?.r.month ?? from,
				)
			: null;
	const out = { late: [] as MonthKey[], revised: [] as MonthKey[] };
	for (const { r, next, moved } of changed) {
		const checkpoint = checkpointOf(c, r.month);
		const data: Prisma.MonthCloseUpdateInput = { checkpoint };
		if (moved && lateOnly(c, r.month)) {
			data.summary = next;
			data.lateEntries = await lateCount(c, r);
			out.late.push(r.month);
		} else if (moved) {
			data.summary = next;
			data.revision = r.revision + 1;
			if (recalc) data.recalc = recalc;
			out.revised.push(r.month);
		}
		await c.tx.monthClose.update({ where: { id: r.id }, data });
	}
	return out;
}

/** Closes the open months and revises changed ones; the caller holds the book lock. */
export async function closeAndRevise(
	tx: Tx,
	userId: string,
	now: Date,
	req: ReviseRequest,
	rows: readonly CloseRow[],
): Promise<ReviseResult> {
	const firstOpen = req.open[0] ?? Number.POSITIVE_INFINITY;
	const needFrom = Math.min(
		req.reviseFrom ?? Number.POSITIVE_INFINITY,
		firstOpen,
	);
	const loaded = await loadBook(tx, userId, {
		now,
		needFrom: Math.max(needFrom, 0),
	});
	if (!loaded) return { closed: [], late: [], revised: [] };
	const c: Ctx = {
		tx,
		loaded,
		state: computeBook(loaded.input),
		now,
		changes: (req.changes ?? []).map((ch) => ({
			fromMonth: ch.fromMonth,
			day: isoDateIn(ch.createdAt, loaded.row.timeZone),
		})),
	};
	const changed =
		req.reviseFrom === null
			? { late: [], revised: [] }
			: await revise(
					c,
					rows,
					Math.max(req.reviseFrom, loaded.input.startMonth),
				);
	if (req.open.length > 0)
		await tx.monthClose.createMany({
			data: req.open.map((month) => ({
				bookId: loaded.row.id,
				month,
				mode: "AUTO" as const,
				summary: summaryOf(c, month),
				checkpoint: checkpointOf(c, month),
			})),
			skipDuplicates: true,
		});
	return { closed: [...req.open], ...changed };
}
