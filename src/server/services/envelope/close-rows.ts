/**
 * A book's closed months as the loader and the close service read them:
 * one query for the closes (summary, checkpoint, revision, acknowledgement,
 * late entries, recalculation) and one for the budget_dirty marks, and the
 * choice of the checkpoint a pass starts at (checkpoint.ts).
 */
import { z } from "zod";
import {
	type MonthCloseSummary,
	monthCloseSummarySchema,
} from "~/lib/schemas/envelope";
import type { Prisma } from "~prisma";
import { readCheckpoint, type StoredCheckpoint } from "./checkpoint";
import type { MonthKey } from "./types";

type Tx = Prisma.TransactionClient;

/** What a change after the late window did to today's numbers (C16). */
export const recalcSchema = z.object({
	changeId: z.string(),
	at: z.string(),
	/** The earliest closed month the change reached. */
	earliestMonth: z.number().int(),
	toAssign: z.number().int(),
	envelopes: z.array(z.object({ id: z.string(), delta: z.number().int() })),
});
export type Recalc = z.infer<typeof recalcSchema>;

export interface CloseRow {
	id: string;
	month: MonthKey;
	summary: MonthCloseSummary;
	checkpoint: StoredCheckpoint | null;
	revision: number;
	closedAt: Date;
	acknowledgedAt: Date | null;
	ackRevision: number | null;
	lateEntries: number;
	recalc: Recalc | null;
}

export interface DirtyMark {
	id: bigint;
	fromMonth: number;
	/** When the change was made: the late window counts from here (C17). */
	createdAt: Date;
}

export async function loadCloseRows(
	tx: Tx,
	bookId: string,
): Promise<CloseRow[]> {
	const rows = await tx.monthClose.findMany({
		where: { bookId },
		orderBy: { month: "asc" },
	});
	return rows.map((r) => {
		const recalc = recalcSchema.safeParse(r.recalc);
		return {
			id: r.id,
			month: r.month,
			summary: monthCloseSummarySchema.parse(r.summary),
			checkpoint: readCheckpoint(r.checkpoint),
			revision: r.revision,
			closedAt: r.closedAt,
			acknowledgedAt: r.acknowledgedAt,
			ackRevision: r.ackRevision,
			lateEntries: r.lateEntries,
			recalc: recalc.success ? recalc.data : null,
		};
	});
}

export function loadDirtyMarks(tx: Tx, bookId: string): Promise<DirtyMark[]> {
	return tx.budgetDirty.findMany({
		where: { bookId },
		select: { id: true, fromMonth: true, createdAt: true },
	});
}

/**
 * The latest checkpoint a pass may start from: before `needFrom` (the first
 * month the caller reads), before every dirty mark, and with the
 * fingerprint of the fully loaded rows unchanged.
 */
export function pickCheckpoint(
	closes: readonly CloseRow[],
	p: {
		needFrom: MonthKey;
		currentMonth: MonthKey;
		dirty: readonly DirtyMark[];
		prints: ReadonlyMap<MonthKey, string>;
	},
): StoredCheckpoint | null {
	const dirtyFrom = Math.min(
		Number.POSITIVE_INFINITY,
		...p.dirty.map((d) => d.fromMonth),
	);
	let best: StoredCheckpoint | null = null;
	for (const c of closes) {
		const cp = c.checkpoint;
		if (!cp || cp.month !== c.month) continue;
		if (cp.month >= p.needFrom || cp.month >= p.currentMonth) continue;
		if (cp.month >= dirtyFrom) continue;
		if (p.prints.get(cp.month) !== cp.print) continue;
		if (!best || cp.month > best.month) best = cp;
	}
	return best;
}
