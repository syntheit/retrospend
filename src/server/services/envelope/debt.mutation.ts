/**
 * Pay down a debt as a money mutation (R30, R15): the preview is the same
 * write rolled back, so it lists the liability, the paying account, the
 * envelope and Not planned yet as they will be. The undo deletes the
 * transfer, which takes its legs, the interest expense and the budget side
 * with it.
 */
import type {
	DebtPaymentResult,
	RecordDebtPaymentInput,
} from "~/lib/schemas/envelope-debt";
import type { AccountChange } from "../accounts/ledger";
import type { MoneyMutation } from "../preview/types";
import { TRANSFER_FIGURES } from "../transfers/create.mutation";
import { payDebt, recordDebtPayment } from "./debt-payment.service";
import { FIGURE_TOTAL_DEBT } from "./figures";

export const recordDebtPaymentMutation: MoneyMutation<
	RecordDebtPaymentInput,
	DebtPaymentResult
> = {
	id: "envelope.recordDebtPayment",
	touches: [...TRANSFER_FIGURES, FIGURE_TOTAL_DEBT],
	scope: (input) => ({
		accountId: input.liabilityId,
		...(input.envelopeId ? { envelopeId: input.envelopeId } : {}),
	}),
	run: async (tx, input, actor) => {
		const value = await recordDebtPayment(tx, actor.userId, input, new Date());
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "transfer.delete",
				rows: [{ table: "transfer", id: value.transferId }],
			},
		};
	},
};

/**
 * The undo of deleting a debt payment: the same payment again, as the web's
 * own mutation (so the preview is the dry run of it), answering with the
 * account changes the transfers undo route reports.
 */
export const restoreDebtPaymentMutation: MoneyMutation<
	RecordDebtPaymentInput,
	{ id: string; accounts: readonly AccountChange[] }
> = {
	...recordDebtPaymentMutation,
	run: async (tx, input, actor) => {
		const { result, accounts } = await payDebt(
			tx,
			actor.userId,
			input,
			new Date(),
		);
		return {
			value: { id: result.transferId, accounts },
			undo: {
				kind: "revert",
				mutation: "transfer.delete",
				rows: [{ table: "transfer", id: result.transferId }],
			},
		};
	},
};
