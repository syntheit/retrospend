/**
 * Starting money (D34, SPEC §8.2): "How much do you have right now?", asked
 * when an income budget starts without an answer (Needs you: Starting
 * money). Confirming writes the STARTING_BALANCE money-in row, so To assign
 * starts from what you have, and records the answer; 0 is an answer with no
 * row. Dated the book's first day while that month is still open, else today,
 * so a closed month never gains money after the fact.
 */
import type {
	ConfirmStartingMoneyInput,
	ConfirmStartingMoneyResult,
} from "~/lib/schemas/envelope-crud";
import type { Prisma } from "~prisma";
import { writeEntryRow } from "./adjustment";
import { assertNewChange, recordChange } from "./envelope-change";
import { EnvelopeError } from "./errors";
import { forgetMonthViews } from "./month-read";
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
	const firstMonthOpen = book.startMonth === s.current;
	const money =
		input.amountMinor === 0
			? null
			: await writeEntryRow(tx, userId, {
					minor: input.amountMinor,
					currency: H,
					rateType: s.loaded.valuation.defaultRateType,
					date: firstMonthOpen ? book.startDate : now,
					today: s.loaded.today,
					direction: "IN",
					entryKind: "STARTING_BALANCE",
				});
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
		before: { expenseId: money?.id ?? null },
	});
	forgetMonthViews(tx);
	return {
		changeId: input.id,
		amount: { minor: input.amountMinor, currency: H },
		expenseId: money?.id ?? null,
		confirmedAt: now,
	};
}
