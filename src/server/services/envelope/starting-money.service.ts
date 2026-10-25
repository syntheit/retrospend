/**
 * Starting money (D34, SPEC §8.2): "How much do you have right now?", asked
 * when an income budget starts without an answer (Needs you: Starting
 * money). Like Set what I have now (P4) it means money in hand today, so the
 * STARTING_BALANCE row is the answer minus what the budget holds (spending
 * since the start has already left it), computed under the book lock, and the
 * budget then holds exactly what you said. No row is written when nothing is
 * needed. Dated the local noon of the book's first day while that month is
 * still open, else of today, so a closed month never gains money after the
 * fact.
 */
import { randomUUID } from "node:crypto";
import type {
	ConfirmStartingMoneyInput,
	ConfirmStartingMoneyResult,
} from "~/lib/schemas/envelope-crud";
import type { Prisma } from "~prisma";
import { writeAdjustment, writeEntryRow } from "./adjustment";
import { holdsForAdjustment } from "./bank";
import { assertNewChange, recordChange } from "./envelope-change";
import { EnvelopeError } from "./errors";
import { forgetMonthViews, monthViewIn } from "./month-read";
import { isoDateIn } from "./months";
import { lockedSnapshot } from "./movement-state";

type Tx = Prisma.TransactionClient;

export async function confirmStartingMoney(
	tx: Tx,
	userId: string,
	input: ConfirmStartingMoneyInput,
	now: Date,
): Promise<ConfirmStartingMoneyResult> {
	const s = await lockedSnapshot(tx, userId, now);
	const book = s.loaded.row;
	const H = s.loaded.book.currency;
	if (book.startingMoneyConfirmedAt)
		throw new EnvelopeError(
			"INVALID",
			"starting money is confirmed: record a difference with Does this match your bank",
		);
	if (book.fundingSource === "TARGETS")
		throw new EnvelopeError(
			"INVALID",
			"a Limits budget does not start from money in hand",
		);
	await assertNewChange(tx, input.id);
	const view = await monthViewIn(tx, userId, now);
	if (!view) throw new EnvelopeError("NO_BOOK", "start a budget first");
	// Positive: money in the budget does not hold yet. Negative: it holds more than you have.
	const booked = input.amountMinor - holdsForAdjustment(view);
	const firstMonthOpen = book.startMonth === s.current;
	const since = isoDateIn(book.startDate, book.timeZone);
	const money =
		booked <= 0
			? null
			: await writeEntryRow(tx, userId, {
					minor: booked,
					currency: H,
					rateType: s.loaded.valuation.defaultRateType,
					date: new Date(
						`${firstMonthOpen ? since : s.loaded.today}T12:00:00Z`,
					),
					today: s.loaded.today,
					direction: "IN",
					entryKind: "STARTING_BALANCE",
				});
	// Like Set what I have now: the shortfall is an OUT Adjustment dated today, so the answer still confirms.
	const adjustment =
		booked < 0
			? await writeAdjustment(tx, userId, {
					id: randomUUID(),
					signedMinor: booked,
					currency: H,
					rateType: s.loaded.valuation.defaultRateType,
					date: now,
					today: s.loaded.today,
				})
			: null;
	await tx.budgetBook.update({
		where: { id: book.id },
		data: {
			startingBalanceExpenseId: money?.id ?? null,
			startingMoneyConfirmedAt: now,
		},
	});
	await recordChange(tx, {
		id: input.id,
		bookId: book.id,
		userId,
		kind: "CONFIRM_STARTING_MONEY",
		envelopeId: null,
		before: {
			expenseId: money?.id ?? null,
			adjustmentId: adjustment?.expenseId ?? null,
		},
	});
	forgetMonthViews(tx);
	return {
		changeId: input.id,
		amount: { minor: input.amountMinor, currency: H },
		booked: { minor: booked, currency: H },
		alreadySpent: { minor: booked - input.amountMinor, currency: H },
		since,
		expenseId: money?.id ?? null,
		adjustmentId: adjustment?.expenseId ?? null,
		confirmedAt: now,
	};
}
