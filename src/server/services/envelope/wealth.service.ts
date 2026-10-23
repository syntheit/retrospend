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
	/** Named by the caller when nothing else keys the move (a Move in without income). */
	id?: string | null;
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
			reason:
				| "no_envelope_budget"
				| "other_currency"
				| "nothing_to_move"
				| "id_reused";
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
	const id = move.id ?? randomUUID();
	const day = isoDateIn(move.date, book.timeZone);
	try {
		await insertMove(tx, move, {
			id,
			bookId: book.id,
			envelopeId: envelope?.id ?? null,
			day,
			currency: book.currency,
		});
	} catch (error) {
		// The id is taken by a row we may not see (RLS): a reused id, never a 500.
		if ((error as { code?: string }).code === "P2002")
			return { recorded: false, reason: "id_reused" };
		throw error;
	}
	forgetMonthViews(tx);
	return { recorded: true, id, envelopeId: envelope?.id ?? null };
}

function insertMove(
	tx: Tx,
	move: WealthMove,
	at: {
		id: string;
		bookId: string;
		envelopeId: string | null;
		day: string;
		currency: string;
	},
) {
	return tx.wealthTransfer.create({
		data: {
			id: at.id,
			bookId: at.bookId,
			direction: move.direction,
			envelopeId: at.envelopeId,
			transferId: move.transferId,
			sourceExpenseId: move.sourceExpenseId,
			assetAccountId: move.assetAccountId,
			countOnly: move.countOnly,
			date: new Date(`${at.day}T00:00:00Z`),
			amount: fromMinor(move.amount.minor, at.currency).toString(),
			actorUserId: move.userId,
		},
	});
}

/** A Move in already recorded under this id (a retry), or null. */
export function recordedMoveIn(tx: Tx, id: string) {
	return tx.wealthTransfer.findFirst({
		where: { id, countOnly: true },
		select: { id: true, amount: true, assetAccountId: true },
	});
}

/**
 * The undo of a Move in: its budget side goes too, keyed on the kept income,
 * or on the Move in's own id when no income stands behind it. Returns how
 * many rows it removed.
 */
export async function removeMoveIn(
	tx: Tx,
	of: { sourceExpenseId: string } | { id: string },
): Promise<number> {
	const { count } = await tx.wealthTransfer.deleteMany({
		where:
			"sourceExpenseId" in of
				? { sourceExpenseId: of.sourceExpenseId }
				: { id: of.id, countOnly: true },
	});
	forgetMonthViews(tx);
	return count;
}

/** True when the user has an envelope budget (where a Move in has a budget side). */
export async function hasEnvelopeBudget(tx: Tx, userId: string) {
	const book = await findPersonalBook(tx, userId);
	return !!book?.defaultEnvelopeId;
}
