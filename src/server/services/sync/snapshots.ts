/**
 * The snapshot readers behind GET /sync/shares and GET /sync/settings (E2EE
 * P16): small tables a device takes whole, where the delta log has nothing to
 * stamp (a share belongs to a shared expense, which more than one person owns).
 *
 * A snapshot selects by access only. It never applies the spending rules, not
 * REJECTED, not a hidden project: the device holds those rules (the same
 * domain filter the figures use) and the parity harness keeps them equal to
 * the server's. Nothing here reads a title, a note, a payer or another
 * participant (the encryption rules).
 */

import type { db as globalDb } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import type { FigureUnavailable } from "~/server/figures/unavailable";
import { type OwedRead, owedOnce } from "~/server/services/payments/figures";
import { ownExpenseCategoryId } from "~/server/services/shared-expense-integration";
import { Prisma } from "~prisma";

/** One of the caller's participations with the fields of its expense the figures read. */
export interface ShareSnapshotRow {
	id: string;
	expenseId: string;
	shareAmount: Prisma.Decimal;
	verificationStatus: "PENDING" | "ACCEPTED" | "REJECTED" | "AUTO_ACCEPTED";
	currency: string;
	date: Date;
	projectId: string | null;
	exchangeRate: Prisma.Decimal | null;
	/** The expense's category when it is the caller's own (D19), else null. */
	expenseCategoryId: string | null;
}

export interface ShareSnapshot {
	shares: ShareSnapshotRow[];
	owed: OwedRead | FigureUnavailable;
}

/**
 * Every participation of `userId`, and Owed to you and You owe, in one
 * repeatable-read read-only transaction: both come from one database snapshot,
 * so a settle-up that commits between the two reads shows in neither or both.
 * The totals are priced at the rates of the moment of the read, as the owed
 * figure always is.
 */
export async function readShareSnapshot(
	db: typeof globalDb,
	userId: string,
): Promise<ShareSnapshot> {
	return userTransaction(
		db,
		userId,
		async (tx) => {
			await tx.$executeRaw`SET TRANSACTION READ ONLY`;
			const rows = await tx.splitParticipant.findMany({
				where: { participantType: "user", participantId: userId },
				select: {
					id: true,
					transactionId: true,
					shareAmount: true,
					verificationStatus: true,
					transaction: {
						select: {
							currency: true,
							date: true,
							projectId: true,
							exchangeRate: true,
							categoryId: true,
							category: { select: { userId: true } },
						},
					},
				},
				orderBy: { id: "asc" },
			});
			const owed = await owedOnce(tx, userId);
			return {
				shares: rows.map((p) => ({
					id: p.id,
					expenseId: p.transactionId,
					shareAmount: p.shareAmount,
					verificationStatus: p.verificationStatus,
					currency: p.transaction.currency,
					date: p.transaction.date,
					projectId: p.transaction.projectId,
					exchangeRate: p.transaction.exchangeRate,
					expenseCategoryId: ownExpenseCategoryId(userId, p.transaction),
				})),
				owed,
			};
		},
		{ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
	);
}
