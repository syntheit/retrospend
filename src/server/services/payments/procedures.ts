/**
 * What the payment procedures do, so the router stays a thin call site:
 * preview and apply through the preview runner (one code path, R30), then
 * the notifications that cannot run inside a preview.
 */
import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import { forUser } from "~/server/services/preview";
import { SettlementService } from "~/server/services/shared-expenses/settlement.service";
import type { PrismaClient } from "~prisma";
import { confirmPayment, paymentCounterparty } from "./confirm.mutation";
import type { confirmPaymentSchema, recordPaymentSchema } from "./input";
import { recordPayment } from "./record.mutation";

type RecordInput = z.infer<typeof recordPaymentSchema>;
type ConfirmInput = z.infer<typeof confirmPaymentSchema>;

/** Why payment.record wrote nothing, as the error the sheet shows. */
const NOT_RECORDED = {
	overpay: "That is more than is owed. Confirm the overpayment to record it.",
	nothing_owed: "There is nothing to settle with this person.",
} as const;

export const previewPayment = (userId: string, input: RecordInput) =>
	forUser(userId).preview(recordPayment, input);

export async function applyPayment(
	db: PrismaClient,
	userId: string,
	input: RecordInput,
) {
	const result = await forUser(userId).apply(recordPayment, input);
	if (!result.value.recorded) {
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
