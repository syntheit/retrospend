/**
 * The input that puts a deleted debt payment back (the inverse of
 * transfer.delete for a payment recordDebtPayment wrote). A payment is more
 * than its transfer: the principal's budget side, the interest as Fees
 * spending in the paying envelope, the NOT_SPENDING mark from outside the
 * budget. A plain transfer recreate brings back none of that, so the undo of
 * deleting a payment replays recordDebtPayment itself.
 *
 * Nothing on the transfer says which path wrote it, so the rows decide: a
 * payment is what only the debt path leaves behind. A plain card payment
 * (POST /transfers) between two in-budget places has no budget side and an
 * uncategorized fee, and stays a plain recreate.
 */
import { inBudget, isLiability } from "@retrospend/domain/accounts/places";
import { toMinor } from "@retrospend/domain/envelope/units";
import type { RecordDebtPaymentInput } from "~/lib/schemas/envelope-debt";
import type { Prisma } from "~prisma";

type Tx = Prisma.TransactionClient;

const DEBT_KINDS: readonly string[] = ["DEBT_PAYMENT", "CARD_PAYMENT"];

export async function debtPaymentOf(
	tx: Tx,
	userId: string,
	transfer: Prisma.TransferGetPayload<object>,
): Promise<RecordDebtPaymentInput | null> {
	if (!DEBT_KINDS.includes(transfer.kind) || !transfer.toAccountId) return null;
	const book = await tx.budgetBook.findFirst({
		where: { createdById: userId, isPersonal: true },
		select: { currency: true },
	});
	// recordDebtPayment is book currency only; anything else was a plain transfer.
	const H = book?.currency;
	if (!H || transfer.fromCurrency !== H || transfer.toCurrency !== H)
		return null;
	const to = await tx.assetAccount.findUnique({
		where: { id: transfer.toAccountId },
	});
	if (!to || !isLiability(to.type)) return null;
	const from = transfer.fromAccountId
		? await tx.assetAccount.findUnique({
				where: { id: transfer.fromAccountId },
			})
		: null;
	if (transfer.fromAccountId && !from) return null;
	const side = await tx.wealthTransfer.findFirst({
		where: { transferId: transfer.id },
		select: { direction: true, envelopeId: true },
	});
	const fee = transfer.feeExpenseId
		? await tx.expense.findUnique({
				where: { id: transfer.feeExpenseId },
				select: {
					amount: true,
					categoryId: true,
					budgetEnvelopeId: true,
					entryKind: true,
				},
			})
		: null;
	const toIn = inBudget(to, H);
	const fromIn = from ? inBudget(from, H) : true;
	const marked =
		fee !== null &&
		(fee.categoryId !== null ||
			fee.budgetEnvelopeId !== null ||
			fee.entryKind === "NOT_SPENDING");
	// In budget to in budget, a plain transfer writes no side: this one is the debt path's.
	const principalSide = fromIn && toIn && side?.direction === "TO_WEALTH";
	// From outside the budget the debt path writes no side and no fee mark, and
	// a plain transfer would write one when units enter: replay what is there.
	const outsideBare = !fromIn && toIn && !side && !fee;
	if (!marked && !principalSide && !outsideBare) return null;
	return {
		id: transfer.id,
		liabilityId: to.id,
		fromAccountId: transfer.fromAccountId,
		envelopeId: side?.direction === "TO_WEALTH" ? side.envelopeId : null,
		principalMinor: toMinor(transfer.toAmount, H),
		interestMinor: fee ? toMinor(fee.amount, H) : 0,
		interestCategoryId: fee?.categoryId ?? null,
		date: transfer.date.toISOString().slice(0, 10),
	};
}
