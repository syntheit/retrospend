/**
 * The budget's half of a money move (D24, SPEC §5.11, MONEY-MOVES §5.2):
 * transfers/budget-side.ts calls this when a transfer crosses the budget
 * line or a Move in counts kept income.
 *
 * - TO_WEALTH: out of the named envelope's Activity, else out of To assign
 *   ("the server takes it from the linked envelope, else To assign").
 * - FROM_WEALTH: into the named envelope, else into To assign.
 *
 * The row goes with what made it: deleting the transfer or the kept income
 * deletes it (CASCADE in M8); undoing a Move in calls removeMoveIn. Written
 * on the caller's transaction, so the transfer's preview shows the budget
 * figures move.
 */
import { randomUUID } from "node:crypto";
import type { Prisma } from "~prisma";
import { findPersonalBook } from "./inputs";
import { forgetMonthViews } from "./month-read";
import { isoDateIn } from "./months";
import { fromMinor } from "./units";

type Tx = Prisma.TransactionClient;

export interface WealthMove {
	userId: string;
	direction: "TO_WEALTH" | "FROM_WEALTH";
	/** In the book currency. */
	amount: { minor: number; currency: string };
	envelopeId: string | null;
	date: Date;
	transferId: string | null;
	countOnly: boolean;
	sourceExpenseId: string | null;
	assetAccountId: string | null;
}

export type WealthMoveResult =
	| { recorded: true; id: string; envelopeId: string | null }
	| {
			recorded: false;
			reason: "no_envelope_budget" | "other_currency" | "nothing_to_move";
	  };

/** Writes the budget side of a move; says why when it does not. */
export async function recordWealthMove(
	tx: Tx,
	move: WealthMove,
): Promise<WealthMoveResult> {
	const book = await findPersonalBook(tx, move.userId);
	if (!book?.defaultEnvelopeId)
		return { recorded: false, reason: "no_envelope_budget" };
	if (move.amount.currency !== book.currency)
		return { recorded: false, reason: "other_currency" };
	if (move.amount.minor <= 0)
		return { recorded: false, reason: "nothing_to_move" };
	// An envelope that is not open in this book: the move uses To assign.
	const envelope = book.envelopes.find(
		(e) => e.id === move.envelopeId && e.archivedAt === null,
	);
	const id = randomUUID();
	const day = isoDateIn(move.date, book.timeZone);
	await tx.wealthTransfer.create({
		data: {
			id,
			bookId: book.id,
			direction: move.direction,
			envelopeId: envelope?.id ?? null,
			transferId: move.transferId,
			sourceExpenseId: move.sourceExpenseId,
			assetAccountId: move.assetAccountId,
			countOnly: move.countOnly,
			date: new Date(`${day}T00:00:00Z`),
			amount: fromMinor(move.amount.minor, book.currency).toString(),
			actorUserId: move.userId,
		},
	});
	forgetMonthViews(tx);
	return { recorded: true, id, envelopeId: envelope?.id ?? null };
}

/**
 * The undo of a Move in: its budget side goes too. A kept income's is keyed
 * on the income; a Move in of an account's money has no key, so its undo
 * takes the newest count-only move of that account (undo runs right after).
 */
export async function removeMoveIn(
	tx: Tx,
	of: { sourceExpenseId: string } | { assetAccountId: string },
): Promise<void> {
	if ("sourceExpenseId" in of) {
		await tx.wealthTransfer.deleteMany({
			where: { sourceExpenseId: of.sourceExpenseId },
		});
	} else {
		const newest = await tx.wealthTransfer.findFirst({
			where: {
				assetAccountId: of.assetAccountId,
				countOnly: true,
				sourceExpenseId: null,
				transferId: null,
			},
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
			select: { id: true },
		});
		if (newest) await tx.wealthTransfer.delete({ where: { id: newest.id } });
	}
	forgetMonthViews(tx);
}
