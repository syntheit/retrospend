/**
 * What the payment procedures do, so the router stays a thin call site:
 * preview and apply through the preview runner (one code path, R30), then
 * the notifications that cannot run inside a preview.
 */
import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import { resolveParticipantName } from "~/server/services/notifications";
import { forUser } from "~/server/services/preview";
import { SettlementService } from "~/server/services/shared-expenses/settlement.service";
import type { PrismaClient } from "~prisma";
import { claimMatchError } from "./claim-match";
import {
	confirmPayment,
	paymentCounterparty,
	unconfirmPayment,
} from "./confirm.mutation";
import type { confirmPaymentSchema, recordPaymentSchema } from "./input";
import { recordPayment } from "./record.mutation";

type RecordInput = z.infer<typeof recordPaymentSchema>;
type ConfirmInput = z.infer<typeof confirmPaymentSchema>;

/**
 * An amount above everything owed. It is a BAD_REQUEST on the web, as before;
 * API v1 answers it with its own problem code (`overpay`), so a client can
 * tell it from any other bad request.
 */
export class OverpayError extends TRPCError {
	constructor(message: string) {
		super({ code: "BAD_REQUEST", message });
		this.name = "OverpayError";
	}
}

/** Why payment.record wrote nothing, as the error the sheet shows. */
const NOT_RECORDED = {
	overpay: "That is more than is owed. Confirm the overpayment to record it.",
	nothing_owed: "There is nothing to settle with this person.",
	matches_claim:
		"They already say they paid you this. Confirm that payment instead.",
} as const;

export const previewPayment = (
	userId: string,
	input: RecordInput,
	timeZone?: string,
) => forUser(userId).preview(recordPayment, { ...input, timeZone });

export async function applyPayment(
	db: PrismaClient,
	userId: string,
	input: RecordInput,
	timeZone?: string,
) {
	const result = await forUser(userId).apply(recordPayment, {
		...input,
		timeZone,
	});
	if (!result.value.recorded && result.value.reason === "matches_claim") {
		const { match } = result.value;
		const header = match
			? await db.payment.findUnique({ where: { id: match.claim.paymentId } })
			: null;
		if (match && header) {
			throw claimMatchError(
				match,
				await resolveParticipantName(header.payerType, header.payerId),
			);
		}
	}
	if (!result.value.recorded) {
		if (result.value.reason === "overpay")
			throw new OverpayError(NOT_RECORDED.overpay);
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: NOT_RECORDED[result.value.reason],
		});
	}
	const service = new SettlementService(db, userId);
	if (input.matchClaimId)
		await notifyConfirmedPayment(db, service, result.value.paymentId);
	else await service.notifyPaymentRecorded(result.value.paymentId);
	return result;
}

export async function previewConfirm(
	db: PrismaClient,
	userId: string,
	input: ConfirmInput,
) {
	const person = await paymentCounterparty(db, input.paymentId, userId);
	return forUser(userId).preview(confirmPayment, { ...input, person });
}

export async function applyConfirm(
	db: PrismaClient,
	userId: string,
	input: ConfirmInput,
) {
	const person = await paymentCounterparty(db, input.paymentId, userId);
	const result = await forUser(userId).apply(confirmPayment, {
		...input,
		person,
	});
	await notifyConfirmedPayment(
		db,
		new SettlementService(db, userId),
		result.value.paymentId,
	);
	return result;
}

async function notifyConfirmedPayment(
	db: PrismaClient,
	service: SettlementService,
	paymentId: string,
) {
	const rows = await db.settlement.findMany({
		where: { paymentGroupId: paymentId },
	});
	const lead = rows.find((r) => !r.isOffset) ?? rows[0];
	if (lead) await service.notifyConfirmed(rows, lead);
}

/** Undo of a confirm, previewed (R30: an undo has its own preview) or applied. */
export async function unconfirm(
	db: PrismaClient,
	userId: string,
	paymentId: string,
	mode: "preview" | "apply",
) {
	const person = await paymentCounterparty(db, paymentId, userId);
	const runner = forUser(userId);
	const input = { paymentId, person };
	return mode === "preview"
		? runner.preview(unconfirmPayment, input)
		: runner.apply(unconfirmPayment, input);
}
