import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";

/**
 * The page cursor of a person's ledger: the date and id of the last row, so
 * rows that share a date with it are never skipped. A cursor with only a
 * date (an older client) still works, on the date alone.
 */
export function encodeLedgerCursor(row: { date: Date; id: string }): string {
	return `${row.date.toISOString()}|${row.id}`;
}

export function ledgerCursorWhere(
	cursor: string,
): Prisma.SharedTransactionWhereInput {
	const [iso, id] = cursor.split("|");
	const date = new Date(iso ?? "");
	if (Number.isNaN(date.getTime())) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid cursor" });
	}
	return id
		? { OR: [{ date: { lt: date } }, { date, id: { lt: id } }] }
		: { date: { lt: date } };
}

type Ref = { participantType: string; participantId: string };

/**
 * Everyone on an expense you can read: its split rows, plus the payer. The
 * payer's own split row is not yours to read (row level security shows you
 * your row, and the others only inside a project you share), but the payer is
 * on the expense itself.
 */
export function peopleOn<T extends Ref>(
	tx: { paidByType: string; paidById: string },
	splits: readonly T[],
): (T | Ref)[] {
	const paid = (r: Ref) =>
		r.participantType === tx.paidByType && r.participantId === tx.paidById;
	return splits.some(paid)
		? [...splits]
		: [
				...splits,
				{ participantType: tx.paidByType, participantId: tx.paidById },
			];
}
