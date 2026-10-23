/**
 * Month summaries after the close (SPEC §5.5, §6.6): what a closed month
 * ended with, its revision, its late entries and the latest change after
 * its window; and the acknowledgement that clears the summary and change
 * items from Needs you. Runs on the caller's transaction (RLS set).
 */
import type {
	AcknowledgeMonthInput,
	MonthSummaryOutput,
} from "~/lib/schemas/envelope-book";
import type { Prisma } from "~prisma";
import { type CloseRow, loadCloseRows } from "./close-rows";
import { EnvelopeError } from "./errors";
import { findPersonalBook } from "./inputs";

type Tx = Prisma.TransactionClient;

export function summaryDto(
	row: CloseRow,
	currency: string,
): MonthSummaryOutput {
	const money = (minor: number) => ({ minor, currency });
	return {
		summary: row.summary,
		closedAt: row.closedAt,
		revision: row.revision,
		acknowledgedRevision: row.ackRevision,
		lateEntries: row.lateEntries > 0 ? row.lateEntries : null,
		change: row.recalc
			? {
					earliestMonth: row.recalc.earliestMonth,
					toAssign: money(row.recalc.toAssign),
					envelopes: row.recalc.envelopes.map((e) => ({
						id: e.id,
						delta: money(e.delta),
					})),
					at: row.recalc.at,
				}
			: null,
	};
}

/** A closed month's summary, or null when it has not closed. */
export async function monthSummaryIn(
	tx: Tx,
	userId: string,
	month: number,
): Promise<MonthSummaryOutput | null> {
	const book = await findPersonalBook(tx, userId);
	if (!book) return null;
	const row = (await loadCloseRows(tx, book.id)).find((r) => r.month === month);
	return row ? summaryDto(row, book.currency) : null;
}

/** "Done" on a summary: that revision is read; a later revision waits again. */
export async function acknowledgeMonth(
	tx: Tx,
	userId: string,
	input: AcknowledgeMonthInput,
	now: Date,
) {
	const book = await findPersonalBook(tx, userId);
	if (!book) throw new EnvelopeError("NO_BOOK", "start a budget first");
	const row = await tx.monthClose.findUnique({
		where: { bookId_month: { bookId: book.id, month: input.month } },
		select: { id: true, revision: true, ackRevision: true },
	});
	if (!row) throw new EnvelopeError("NOT_FOUND", "that month has not closed");
	if (input.revision > row.revision)
		throw new EnvelopeError("INVALID", "that revision does not exist yet");
	// An older acknowledgement never overwrites a newer one.
	const revision = Math.max(input.revision, row.ackRevision ?? 0);
	await tx.monthClose.update({
		where: { id: row.id },
		data: { acknowledgedAt: now, ackRevision: revision },
	});
	return { month: input.month, acknowledgedRevision: revision };
}
