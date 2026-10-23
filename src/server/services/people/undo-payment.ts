/**
 * Undo of a payment just recorded from the Settle up sheet (R15): the
 * toast's Undo removes the whole payment again through today's guarded
 * paths, so the same rules hold. A payment still waiting for the other side
 * is deleted (only its recorder may); a final one the viewer recorded
 * (money received, or paid to someone not on Retrospend) is voided. A
 * confirmed claim ("Same payment") is undone with settlement.paymentUnconfirm.
 */
import { TRPCError } from "@trpc/server";
import { SettlementService } from "~/server/services/shared-expenses/settlement.service";
import type { PrismaClient } from "~prisma";

export async function undoRecordedPayment(
	db: PrismaClient,
	userId: string,
	paymentId: string,
): Promise<{ success: true }> {
	const [payment, lead] = await Promise.all([
		db.payment.findUnique({
			where: { id: paymentId },
			select: { status: true },
		}),
		db.settlement.findFirst({
			where: { paymentGroupId: paymentId },
			orderBy: { initiatedAt: "asc" },
			select: { id: true },
		}),
	]);
	if (!payment || !lead)
		throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found" });
	const service = new SettlementService(db, userId);
	if (payment.status === "PROPOSED")
		await service.deletePendingSettlement(lead.id);
	else await service.voidAutoFinalizedSettlement(lead.id);
	return { success: true };
}
