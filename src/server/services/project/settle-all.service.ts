/**
 * What the Settle all procedures do: preview and apply project.settleAll
 * through the preview runner (one code path, R30), the notifications a
 * preview cannot send, and Undo. Undo takes back each payment the apply
 * wrote: a payment still waiting for the other person is deleted, one that
 * was final at once (they paid you, or a person not on Retrospend) is
 * voided, the same two ways the payment's own menu offers.
 */
import { TRPCError } from "@trpc/server";
import { forUser } from "~/server/services/preview";
import { SettlementService } from "~/server/services/shared-expenses/settlement.service";
import type { PrismaClient } from "~prisma";
import { settleAllInProject } from "./settle-all.mutation";

export const previewSettleAll = (
	userId: string,
	projectId: string,
	timeZone?: string,
) => forUser(userId).preview(settleAllInProject, { projectId, timeZone });

export async function applySettleAll(
	db: PrismaClient,
	userId: string,
	projectId: string,
	timeZone?: string,
) {
	const result = await forUser(userId).apply(settleAllInProject, {
		projectId,
		timeZone,
	});
	if (result.value.lines.length === 0) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Everyone is even with you in this project.",
		});
	}
	const service = new SettlementService(db, userId);
	for (const line of result.value.lines)
		await service.notifyPaymentRecorded(line.paymentId);
	return result;
}

/** Takes back the payments one Settle all wrote. Only their recorder may. */
export async function undoSettleAll(
	db: PrismaClient,
	userId: string,
	paymentIds: readonly string[],
) {
	const service = new SettlementService(db, userId);
	for (const paymentId of paymentIds) {
		const row = await db.settlement.findFirst({
			where: { paymentGroupId: paymentId },
			select: { id: true, status: true },
		});
		if (!row) continue;
		if (row.status === "PROPOSED")
			await service.deletePendingSettlement(row.id);
		else await service.voidAutoFinalizedSettlement(row.id);
	}
	return { undone: paymentIds.length };
}
