/**
 * Keeps Payment headers in step when the people on settlement rows are
 * rewritten outside the payments engine: a shadow claimed, a guest turned
 * user, an account deleted (claim, guest-migration and user-deletion
 * services). A header names the same people as its rows and carries their
 * status; a header with no rows left is removed.
 */
import { groupStatus } from "~/server/services/shared-expenses/settlement-groups";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import type { Prisma, PrismaClient, SettlementStatus } from "~prisma";

type Tx = Pick<
	Prisma.TransactionClient | PrismaClient,
	"payment" | "settlement"
>;

/** Re-points every header that names `from` (payer, payee or recorder) to `to`. */
export async function repointPaymentParty(
	tx: Tx,
	from: ParticipantRef,
	to: ParticipantRef,
): Promise<void> {
	await tx.payment.updateMany({
		where: { payerType: from.participantType, payerId: from.participantId },
		data: { payerType: to.participantType, payerId: to.participantId },
	});
	await tx.payment.updateMany({
		where: { payeeType: from.participantType, payeeId: from.participantId },
		data: { payeeType: to.participantType, payeeId: to.participantId },
	});
	await tx.payment.updateMany({
		where: {
			recordedByType: from.participantType,
			recordedById: from.participantId,
		},
		data: {
			recordedByType: to.participantType,
			recordedById: to.participantId,
		},
	});
}

/**
 * After rows of these payments changed status or were deleted one by one:
 * each header takes its group's status, and a header left without rows is
 * deleted.
 */
export async function syncPaymentHeaders(
	tx: Tx,
	paymentIds: Iterable<string | null | undefined>,
): Promise<void> {
	for (const id of new Set(paymentIds)) {
		if (!id) continue;
		const rows = await tx.settlement.findMany({
			where: { paymentGroupId: id },
			select: { status: true },
		});
		if (rows.length === 0) {
			await tx.payment.deleteMany({ where: { id } });
			continue;
		}
		const status = groupStatus(rows) as SettlementStatus;
		await tx.payment.updateMany({ where: { id }, data: { status } });
	}
}
