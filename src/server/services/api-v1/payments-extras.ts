import type { squareUpSchema } from "@retrospend/api-contract";
import type * as z from "zod";
import { paymentCounterparty } from "~/server/services/payments/confirm.mutation";
import { PAYMENT_FIGURES } from "~/server/services/payments/record.mutation";
import { removeRecordedPayment } from "~/server/services/payments/reverse.mutation";
import { personKey } from "~/server/services/payments/view";
import type { MoneyMutation } from "~/server/services/preview/types";
import { toMinor } from "~/server/services/envelope/units";
import {
	getSquareUpOptions,
	notifySquaredUp,
	type SquareUpInput,
	type SquaredUp,
	squareUpIn,
} from "~/server/services/shared-expenses/settlement-square-up";
import type { Caller } from "./caller";
import { applyWrite, previewWrite, undoFor } from "./money-write";

/**
 * v1 adapters for removing a payment and squaring up projects. Both are the
 * web's own code: the remove mutation SettlementService runs, and the
 * square-up write run as a mutation so it previews.
 */

type SquareUpBody = z.infer<typeof squareUpSchema>;

const FAMILY = "payment" as const;

const me = (caller: Caller) => ({
	participantType: "user" as const,
	participantId: caller.principal.userId,
});

// ── Remove ──────────────────────────────────────────────────────────────────

async function removeInput(caller: Caller, id: string) {
	return {
		paymentId: id,
		person: await paymentCounterparty(caller.db, id, caller.principal.userId),
	};
}

export async function removePayment(caller: Caller, id: string) {
	const value = await applyWrite(
		caller,
		removeRecordedPayment,
		await removeInput(caller, id),
	);
	return { id: value.paymentId, mode: value.mode };
}

export async function previewRemovePayment(caller: Caller, id: string) {
	return previewWrite(
		caller,
		removeRecordedPayment,
		await removeInput(caller, id),
	);
}

// ── Square up ───────────────────────────────────────────────────────────────

const squareUpMutation: MoneyMutation<SquareUpInput, SquaredUp> = {
	id: "payment.squareUp",
	touches: PAYMENT_FIGURES,
	scope: (input) => ({ personId: personKey(input.toParticipant) }),
	run: async (tx, input, actor) => {
		const done = await squareUpIn(
			tx,
			{ participantType: "user", participantId: actor.userId },
			input,
		);
		return {
			value: done,
			undo: {
				kind: "revert",
				mutation: "payment.remove",
				rows: [{ table: "payment", id: done.paymentGroupId }],
			},
		};
	},
};

const squareUpInput = (body: SquareUpBody): SquareUpInput => ({
	toParticipant: {
		participantType: body.person.type,
		participantId: body.person.id,
	},
	currency: body.currency,
});

export async function squareUp(caller: Caller, body: SquareUpBody) {
	const input = squareUpInput(body);
	const done = await applyWrite(caller, squareUpMutation, input);
	await notifySquaredUp(me(caller), input, done);
	return {
		id: done.paymentGroupId,
		status: done.requiresPayeeConfirmation
			? ("PROPOSED" as const)
			: ("FINALIZED" as const),
		// Taking it back removes the payment, like any payment just recorded.
		undo: undoFor(caller, FAMILY, "payment.remove", {
			paymentId: done.paymentGroupId,
		}),
	};
}

export const previewSquareUp = (caller: Caller, body: SquareUpBody) =>
	previewWrite(caller, squareUpMutation, squareUpInput(body));

export async function readSquareUpOptions(
	caller: Caller,
	person: { type: "user" | "guest" | "shadow"; id: string },
) {
	const options = await getSquareUpOptions(caller.db, me(caller), {
		participantType: person.type,
		participantId: person.id,
	});
	const money = (amount: number, currency: string) => ({
		minor: toMinor(String(amount), currency),
		currency,
	});
	return {
		items: options.map((o) => ({
			currency: o.currency,
			amount: money(o.amount, o.currency),
			scopes: o.scopes.map((s) => ({
				project: s.projectId
					? { id: s.projectId, name: s.projectName ?? "" }
					: null,
				balance: money(s.balance, o.currency),
			})),
		})),
	};
}
