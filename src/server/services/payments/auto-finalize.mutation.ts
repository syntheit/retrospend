/**
 * payment.autoFinalize: a payment the payee left unanswered for 7 days turns
 * final, written exactly like the payee's confirm (`finalizeClaim`) and run
 * through the same runner, so it also appends the `payment.confirmed` event
 * (ids and amounts only) in its transaction. The sweep that picks the
 * payments is auto-finalize.ts; this file only holds the one write.
 */
import { TRPCError } from "@trpc/server";
import type { MoneyMutation } from "~/server/services/preview/types";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import { lockPair } from "./access";
import {
	CONFIRM_FIGURES,
	type ConfirmPaymentValue,
	finalizeClaim,
} from "./confirm.mutation";
import { personKey } from "./view";

/** The payee reopened this payment once, so it waits for a person. */
export class ReopenedError extends TRPCError {
	constructor() {
		super({ code: "CONFLICT", message: "This payment was reopened" });
		this.name = "ReopenedError";
	}
}

export const autoFinalizePayment: MoneyMutation<
	{ readonly paymentId: string; readonly person: ParticipantRef },
	ConfirmPaymentValue
> = {
	id: "payment.autoFinalize",
	touches: CONFIRM_FIGURES,
	scope: (input) => ({ personId: personKey(input.person) }),
	run: async (tx, input, actor) => {
		const me: ParticipantRef = {
			participantType: "user",
			participantId: actor.userId,
		};
		// Locked before the unconfirm check, so a payee who reopens it between
		// the sweep's id list and here has finished before this looks.
		await lockPair(tx, me, input.person);
		const reopened = await tx.auditLogEntry.findFirst({
			where: {
				targetType: "SETTLEMENT",
				context: { path: ["action"], equals: "settlement_unconfirmed" },
				changes: { path: ["paymentGroupId"], equals: input.paymentId },
			},
			select: { id: true },
		});
		if (reopened) throw new ReopenedError();
		const confirmed = await finalizeClaim(
			tx,
			me,
			input.person,
			input.paymentId,
			{},
			{ automatic: true },
		);
		return {
			value: {
				paymentId: confirmed.paymentId,
				counterparty: confirmed.counterparty,
				allocation: null,
			},
			undo: confirmed.undo,
		};
	},
};
