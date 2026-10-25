import type {
	confirmPaymentSchema,
	notReceivedSchema,
	PreviewResult as PreviewDto,
	recordPaymentSchema,
} from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import type * as z from "zod";
import {
	createNotification,
	resolveParticipantName,
} from "~/server/services/notifications";
import { claimMatchError } from "~/server/services/payments/claim-match";
import {
	type ConfirmPaymentValue,
	paymentCounterparty,
	unconfirmPayment,
} from "~/server/services/payments/confirm.mutation";
import {
	applyConfirm,
	applyPayment,
	previewConfirm,
	previewPayment,
} from "~/server/services/payments/procedures";
import type { RecordPaymentValue } from "~/server/services/payments/record.mutation";
import {
	rejectPayment,
	removeRecordedPayment,
} from "~/server/services/payments/reverse.mutation";
import type { AllocationView } from "~/server/services/payments/view";
import { forUser } from "~/server/services/preview";
import { SettlementService } from "~/server/services/shared-expenses/settlement.service";
import {
	describeGroupAmount,
	type GroupRow,
	groupCounterparty,
} from "~/server/services/shared-expenses/settlement-groups";
import { assertMinorUnits } from "./amounts";
import type { Caller } from "./caller";
import {
	applyWrite,
	previewWrite,
	spendUndo,
	toPreviewDto,
	undoFor,
} from "./money-write";
import { thaw } from "./thaw";
import { readUndo } from "./undo";

/**
 * v1 adapters for /payments. Record and confirm are the web's own procedures
 * (payments/procedures.ts); taking back and "not received" run the
 * mutations in payments/reverse.mutation.ts, the same ones SettlementService runs.
 */

type LedgerCaller = Caller & { timeZone: string };
type RecordBody = z.infer<typeof recordPaymentSchema>;
type ConfirmBody = z.infer<typeof confirmPaymentSchema>;
type NotReceivedBody = z.infer<typeof notReceivedSchema>;

const FAMILY = "payment" as const;

function recordInput(body: RecordBody) {
	assertMinorUnits(body.amount, body.currency);
	return {
		id: body.id,
		person: {
			participantType: body.person.type,
			participantId: body.person.id,
		},
		direction: body.direction,
		currency: body.currency,
		amount: body.amount,
		rateType: body.rateType,
		customRate: body.customRate ?? null,
		paymentMethod: body.paymentMethod,
		paidOn: body.paidOn,
		note: body.note,
		applyTo: body.applyTo,
		allowOverpay: body.allowOverpay,
		everything: body.everything,
		matchClaimId: body.matchClaimId,
		differentPayment: body.differentPayment,
	};
}

const confirmInput = (body: ConfirmBody) => ({
	paymentId: body.id,
	paymentMethod: body.paymentMethod,
	paidOn: body.paidOn,
	amount: body.amount,
});

// ── Record ──────────────────────────────────────────────────────────────────

/** Why payment.record wrote nothing, as the error the web shows (procedures.ts). */
const NOT_RECORDED = {
	overpay: "That is more than is owed. Confirm the overpayment to record it.",
	nothing_owed: "There is nothing to settle with this person.",
} as const;

/**
 * A preview must fail where the write fails: payment.record answers instead
 * of throwing when it would write nothing, and the transport turns that into
 * an error.
 */
async function assertRecorded(caller: Caller, value: RecordPaymentValue) {
	if (value.recorded) return;
	if (value.reason === "matches_claim" && value.match) {
		const header = await caller.db.payment.findUnique({
			where: { id: value.match.claim.paymentId },
		});
		if (header) {
			throw claimMatchError(
				value.match,
				await resolveParticipantName(header.payerType, header.payerId),
			);
		}
	}
	throw new TRPCError({
		code: "BAD_REQUEST",
		message:
			value.reason === "matches_claim"
				? "They already say they paid you this. Confirm that payment instead."
				: NOT_RECORDED[value.reason],
	});
}

export async function previewRecordPayment(
	caller: LedgerCaller,
	body: RecordBody,
) {
	const preview = await previewPayment(
		caller.principal.userId,
		recordInput(body),
		caller.timeZone,
	);
	await assertRecorded(caller, preview.value);
	return {
		...toPreviewDto(preview),
		detail: {
			kind: "payment.record" as const,
			allocation: allocationOf(preview.value.allocation),
		},
	};
}

export async function recordPaymentWrite(
	caller: LedgerCaller,
	body: RecordBody,
) {
	const { value } = await applyPayment(
		caller.db,
		caller.principal.userId,
		recordInput(body),
		caller.timeZone,
	);
	if (!value.recorded) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
	return {
		id: value.paymentId,
		status: value.status,
		allocation: allocationOf(value.allocation),
		// A confirmed claim goes back to waiting; anything else is deleted or voided.
		undo: body.matchClaimId
			? undoFor(caller, FAMILY, "payment.unconfirm", {
					paymentId: value.paymentId,
				})
			: undoFor(caller, FAMILY, "payment.remove", {
					paymentId: value.paymentId,
				}),
	};
}

const allocationOf = (a: AllocationView | null) => (a ? thaw(a) : null);

// ── Confirm ─────────────────────────────────────────────────────────────────

/** A received amount is checked against the payment's own currency. */
async function checkConfirmAmount(caller: Caller, body: ConfirmBody) {
	if (!body.amount) return;
	const header =
		(await caller.db.payment.findUnique({
			where: { id: body.id },
			select: { currency: true },
		})) ??
		(await caller.db.settlement.findUnique({
			where: { id: body.id },
			select: { currency: true },
		}));
	if (header) assertMinorUnits(body.amount, header.currency);
}

export async function confirmPaymentWrite(caller: Caller, body: ConfirmBody) {
	await checkConfirmAmount(caller, body);
	const input = confirmInput(body);
	const { value } = await applyConfirm(
		caller.db,
		caller.principal.userId,
		input,
	);
	return confirmed(caller, value, input);
}

function confirmed(
	caller: Caller,
	value: ConfirmPaymentValue,
	input: ReturnType<typeof confirmInput>,
) {
	return {
		id: value.paymentId,
		allocation: allocationOf(value.allocation),
		undo: undoFor(caller, FAMILY, "payment.unconfirm", {
			paymentId: value.paymentId,
			confirm: input,
		}),
	};
}

export async function previewConfirmPayment(caller: Caller, body: ConfirmBody) {
	await checkConfirmAmount(caller, body);
	const preview = await previewConfirm(
		caller.db,
		caller.principal.userId,
		confirmInput(body),
	);
	return {
		...toPreviewDto(preview),
		detail: {
			kind: "payment.confirm" as const,
			allocation: allocationOf(preview.value.allocation),
		},
	};
}

// ── Not received ────────────────────────────────────────────────────────────

async function counterparty(caller: Caller, paymentId: string) {
	return paymentCounterparty(caller.db, paymentId, caller.principal.userId);
}

export async function previewNotReceived(
	caller: Caller,
	body: NotReceivedBody,
) {
	const person = await counterparty(caller, body.id);
	return previewWrite(caller, rejectPayment, {
		paymentId: body.id,
		reason: body.reason,
		person,
	});
}

export async function paymentNotReceived(
	caller: Caller,
	body: NotReceivedBody,
) {
	const person = await counterparty(caller, body.id);
	const { lead, rows } = await applyWrite(caller, rejectPayment, {
		paymentId: body.id,
		reason: body.reason,
		person,
	});
	await new SettlementService(
		caller.db,
		caller.principal.userId,
	).notifyRejected([...rows], lead);
	return { id: lead.paymentGroupId ?? lead.id, status: "REJECTED" as const };
}

// ── Remind ──────────────────────────────────────────────────────────────────

/** The service wants a settlement row id; the payment's lead row stands for it. */
export async function remindPayment(caller: Caller, paymentId: string) {
	const lead = await caller.db.settlement.findFirst({
		where: { paymentGroupId: paymentId },
		orderBy: { initiatedAt: "asc" },
		select: { id: true },
	});
	if (!lead) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found" });
	}
	await new SettlementService(caller.db, caller.principal.userId).sendReminder(
		lead.id,
	);
	return { ok: true as const };
}

// ── Undo ────────────────────────────────────────────────────────────────────

const invalidUndo = () =>
	new TRPCError({
		code: "BAD_REQUEST",
		message: "This undo is not valid anymore",
	});

type Unconfirm = {
	paymentId: string;
	confirm?: ReturnType<typeof confirmInput>;
};

type Inverse = {
	preview: () => Promise<PreviewDto>;
	apply: () => Promise<{ id: string; redo: string | null }>;
};

/** The inverse call a token names, ready to preview or to apply. */
function inverseOf(caller: Caller, op: string, input: unknown): Inverse {
	const userId = caller.principal.userId;
	if (op === "payment.remove") {
		const { paymentId } = input as { paymentId: string };
		const args = async () => ({
			paymentId,
			person: await counterparty(caller, paymentId),
		});
		return {
			preview: async () =>
				previewWrite(caller, removeRecordedPayment, await args()),
			apply: async () => {
				const value = await applyWrite(
					caller,
					removeRecordedPayment,
					await args(),
				);
				return { id: value.paymentId, redo: null };
			},
		};
	}
	if (op === "payment.unconfirm") {
		const { paymentId, confirm } = input as Unconfirm;
		const person = () => counterparty(caller, paymentId);
		return {
			preview: async () =>
				toPreviewDto(
					await forUser(userId).preview(unconfirmPayment, {
						paymentId,
						person: await person(),
					}),
				),
			apply: async () => {
				const { value } = await forUser(userId).apply(unconfirmPayment, {
					paymentId,
					person: await person(),
				});
				return {
					id: value.paymentId,
					redo: undoFor(caller, FAMILY, "payment.confirm", {
						paymentId,
						confirm: confirm ?? { paymentId },
					}),
				};
			},
		};
	}
	if (op === "payment.confirm") {
		const { paymentId, confirm } = input as Unconfirm;
		const args = confirm ?? { paymentId };
		return {
			preview: async () =>
				toPreviewDto(await previewConfirm(caller.db, userId, args)),
			apply: async () => {
				const { value } = await applyConfirm(caller.db, userId, args);
				return {
					id: value.paymentId,
					redo: undoFor(caller, FAMILY, "payment.unconfirm", {
						paymentId,
						confirm: args,
					}),
				};
			},
		};
	}
	throw invalidUndo();
}

/** Each token works once: a second use would undo what its redo just did. */
export function undoPaymentWrite(caller: Caller, token: string) {
	const { op, input } = readUndo(caller.principal.userId, FAMILY, token);
	return spendUndo(caller, token, () => inverseOf(caller, op, input).apply());
}

export function previewUndoPaymentWrite(caller: Caller, token: string) {
	const { op, input } = readUndo(caller.principal.userId, FAMILY, token);
	return inverseOf(caller, op, input).preview();
}
