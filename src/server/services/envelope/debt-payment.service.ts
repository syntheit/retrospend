/**
 * Pay down a debt (SPEC §5.11, S14, B11, D3): one transfer from the paying
 * account to the liability for the principal, and the interest as spending.
 *
 * - Principal: the liability moves toward 0 (the transfer's legs) and the
 *   budget gives it up from the paying envelope as a TO_WEALTH move. A card
 *   in the book currency counts as part of the budget, so the transfer
 *   alone would move nothing; the old-debt principal still leaves the
 *   budget, so its TO_WEALTH is written here, keyed on the transfer.
 * - Interest: the transfer's fee from the paying account, as an expense in
 *   the Fees category (or the one given), so it is Activity in that
 *   category's envelope.
 * - Undo is the transfer's delete: legs, fee expense and the budget side go
 *   with it (CASCADE), so the undo is exact.
 *
 * Book currency only for now: a debt or account in another currency is paid
 * with a transfer (open question in the P6 report).
 */
import type {
	DebtPaymentResult,
	InterestEstimate,
	RecordDebtPaymentInput,
} from "~/lib/schemas/envelope-debt";
import type { Prisma } from "~prisma";
import { createTransferIn } from "../transfers/create.mutation";
import { liabilitiesOf, projectIn } from "./debt.service";
import { EnvelopeError } from "./errors";
import { findPersonalBook } from "./inputs";
import { isoDateIn } from "./months";
import { dec, fromMinor, toMinor } from "./units";
import { recordWealthMove } from "./wealth.service";

type Tx = Prisma.TransactionClient;

function invalid(message: string): never {
	throw new EnvelopeError("INVALID", message);
}

/** The interest category: the one given, else the user's Fees category (a default category). */
async function interestCategory(tx: Tx, given: string | null | undefined) {
	if (given) {
		const ok = await tx.category.count({
			where: { id: given, kind: "EXPENSE" },
		});
		if (!ok) invalid("pick one of your spending categories");
		return given;
	}
	const fees = await tx.category.findFirst({
		where: { name: "Fees", kind: "EXPENSE" },
		select: { id: true },
	});
	return fees?.id ?? null;
}

async function existing(tx: Tx, input: RecordDebtPaymentInput, H: string) {
	const t = await tx.transfer.findUnique({ where: { id: input.id } });
	if (!t) return null;
	const side = await tx.wealthTransfer.findFirst({
		where: { transferId: t.id },
	});
	const fee = t.feeExpenseId
		? await tx.expense.findUnique({ where: { id: t.feeExpenseId } })
		: null;
	const account = await tx.assetAccount.findUniqueOrThrow({
		where: { id: input.liabilityId },
	});
	const balance = {
		minor: toMinor(account.balance, account.currency),
		currency: account.currency,
	};
	return {
		transferId: t.id,
		interestExpenseId: fee?.id ?? null,
		principal: { minor: toMinor(t.toAmount, H), currency: H },
		interest: { minor: fee ? toMinor(fee.amount, H) : 0, currency: H },
		balance: { before: balance, after: balance },
		wealthTransferId: side?.id ?? null,
	} satisfies DebtPaymentResult;
}

export async function recordDebtPayment(
	tx: Tx,
	userId: string,
	input: RecordDebtPaymentInput,
	now: Date,
): Promise<DebtPaymentResult> {
	const book = await findPersonalBook(tx, userId);
	if (!book?.defaultEnvelopeId)
		throw new EnvelopeError("NO_BOOK", "start a budget first");
	const H = book.currency;
	const again = await existing(tx, input, H);
	if (again) return again;
	const [debt] = await liabilitiesOf(tx, [input.liabilityId]);
	if (!debt) throw new EnvelopeError("NOT_FOUND", "no such debt");
	if (debt.currency !== H)
		invalid("pay a debt in another currency with a transfer");
	if (input.fromAccountId) {
		const from = await tx.assetAccount.findFirst({
			where: { id: input.fromAccountId, closedAt: null },
		});
		if (!from) throw new EnvelopeError("NOT_FOUND", "no such account");
		if (from.currency !== H)
			invalid("pay from an account in your budget's currency");
	}
	const categoryId = await interestCategory(tx, input.interestCategoryId);
	const before = { minor: toMinor(debt.balance, H), currency: H };
	const date = input.date ?? isoDateIn(now, book.timeZone);
	const moved = await createTransferIn(tx, userId, {
		id: input.id,
		fromAccountId: input.fromAccountId,
		fromCurrency: H,
		toAccountId: debt.id,
		fromAmount: fromMinor(input.principalMinor, H).toString(),
		kind:
			debt.type === "LIABILITY_CREDIT_CARD" ? "CARD_PAYMENT" : "DEBT_PAYMENT",
		date,
		fee:
			input.interestMinor > 0
				? {
						amount: fromMinor(input.interestMinor, H).toString(),
						accountId: input.fromAccountId,
					}
				: null,
		envelopeId: input.envelopeId,
		timeZone: book.timeZone,
	});
	if (moved.feeExpenseId && categoryId)
		await tx.expense.update({
			where: { id: moved.feeExpenseId },
			data: { categoryId },
		});
	if (!moved.budget.side.recorded) {
		const side = await recordWealthMove(tx, {
			userId,
			direction: "TO_WEALTH",
			amount: { minor: input.principalMinor, currency: H },
			envelopeId: input.envelopeId,
			date: new Date(`${date}T12:00:00Z`),
			transferId: moved.transferId,
			countOnly: false,
			sourceExpenseId: null,
			assetAccountId: debt.id,
		});
		if (!side.recorded) invalid("the payment could not leave the budget");
	}
	const side = await tx.wealthTransfer.findFirst({
		where: { transferId: moved.transferId },
		select: { id: true },
	});
	const after = await tx.assetAccount.findUniqueOrThrow({
		where: { id: debt.id },
	});
	return {
		transferId: moved.transferId,
		interestExpenseId: moved.feeExpenseId,
		principal: { minor: input.principalMinor, currency: H },
		interest: { minor: input.interestMinor, currency: H },
		balance: {
			before,
			after: { minor: toMinor(after.balance, H), currency: H },
		},
		wealthTransferId: side?.id ?? null,
	};
}

/**
 * "Interest in this payment" (SPEC §5.11): this month's balance x APR / 12,
 * half-even in the debt's minor units; the prefill is the minimum plus the
 * plan's extra for this debt next month.
 */
export async function interestEstimate(
	tx: Tx,
	userId: string,
	liabilityId: string,
	now: Date,
): Promise<InterestEstimate> {
	const [debt] = await liabilitiesOf(tx, [liabilityId]);
	if (!debt) throw new EnvelopeError("NOT_FOUND", "no such debt");
	const own = (minor: number) => ({ minor, currency: debt.currency });
	const interest = debt.interestRate
		? own(
				toMinor(
					dec(debt.balance).mul(dec(debt.interestRate)).div(1200),
					debt.currency,
				),
			)
		: null;
	const p = await projectIn(tx, userId, {}, now);
	const line = p.debts.find((d) => d.assetAccountId === liabilityId);
	return {
		interest,
		suggested: line ? own(line.nextMinimum.minor + line.nextExtra.minor) : null,
	};
}
