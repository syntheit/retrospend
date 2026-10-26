/**
 * "Remove me" as a money mutation (R30, R15): the call previews as the same
 * write rolled back, and its undo puts the rows back while the expense is as
 * the write left it. The web's own call (VerificationService.removeSelf)
 * runs the same removeSelfIn.
 */
import { TRPCError } from "@trpc/server";
import { SHARED_FIGURES } from "~/server/services/entry/shared.mutation";
import type { MoneyMutation } from "~/server/services/preview/types";
import type { SplitParticipant } from "~prisma";
import { logAudit } from "./audit-log";
import { removeSelfIn } from "./remove-self";

export interface RemoveSelfInput {
	readonly transactionId: string;
	readonly confirmBalanceChange?: boolean;
}

/** A removed share as a token carries it: JSON, so no Decimal and no Date. */
export interface RemovedShare {
	readonly id: string;
	readonly participantType: SplitParticipant["participantType"];
	readonly participantId: string;
	readonly shareAmount: string;
	readonly sharePercentage: string | null;
	readonly shareUnits: number | null;
	readonly verificationStatus: SplitParticipant["verificationStatus"];
	readonly verifiedAt: string | null;
	readonly rejectionReason: string | null;
	readonly hasUnseenChanges: boolean;
	readonly categoryId: string | null;
	readonly categorySource: SplitParticipant["categorySource"];
}

export interface SelfRemoved {
	readonly transactionId: string;
	readonly removed: readonly RemovedShare[];
	/** The expense's stamp after the write: the undo runs only while it still reads this. */
	readonly updatedAt: string;
}

const shareOf = (r: SplitParticipant): RemovedShare => ({
	id: r.id,
	participantType: r.participantType,
	participantId: r.participantId,
	shareAmount: r.shareAmount.toString(),
	sharePercentage: r.sharePercentage?.toString() ?? null,
	shareUnits: r.shareUnits,
	verificationStatus: r.verificationStatus,
	verifiedAt: r.verifiedAt?.toISOString() ?? null,
	rejectionReason: r.rejectionReason,
	hasUnseenChanges: r.hasUnseenChanges,
	categoryId: r.categoryId,
	categorySource: r.categorySource,
});

export const removeSelfMutation: MoneyMutation<RemoveSelfInput, SelfRemoved> = {
	id: "sharedExpense.removeSelf",
	touches: SHARED_FIGURES,
	run: async (tx, input, actor) => {
		// Read the stamp first: without a project, the expense is visible to you only
		// through your own share, which the write removes. Removing a share leaves
		// the expense's own row, and so its stamp, as it is.
		const row = await tx.sharedTransaction.findUnique({
			where: { id: input.transactionId },
			select: { updatedAt: true },
		});
		if (!row)
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Transaction not found or has been deleted",
			});
		const { removed } = await removeSelfIn(
			tx,
			{ participantType: "user", participantId: actor.userId },
			input.transactionId,
			input.confirmBalanceChange ?? false,
		);
		return {
			value: {
				transactionId: input.transactionId,
				removed: removed.map(shareOf),
				updatedAt: row.updatedAt.toISOString(),
			},
			undo: {
				kind: "revert",
				mutation: "sharedExpense.restoreSelf",
				rows: removed.map((r) => ({ table: "split_participant", id: r.id })),
			},
		};
	},
};

export interface RestoreSelfInput {
	readonly transactionId: string;
	readonly removed: readonly RemovedShare[];
	readonly expectedUpdatedAt: string;
}

/** Undo of removeSelf: the same rows back, only while the expense is as the removal left it. */
export const restoreSelfMutation: MoneyMutation<
	RestoreSelfInput,
	{ readonly transactionId: string; readonly restored: number }
> = {
	id: "sharedExpense.restoreSelf",
	touches: SHARED_FIGURES,
	run: async (tx, input, actor) => {
		// Your own rows are visible to you, so these checks work. The expense itself
		// is not visible without a project until your share is back, so it is read
		// after the insert and the restore rolls back if it fails.
		const back = await tx.splitParticipant.count({
			where: {
				transactionId: input.transactionId,
				OR: input.removed.map((r) => ({
					participantType: r.participantType,
					participantId: r.participantId,
				})),
			},
		});
		if (back > 0)
			throw new TRPCError({
				code: "CONFLICT",
				message: "You are on this expense again.",
			});
		// A category deleted since leaves the share without one, as a delete would have.
		const kept = new Set(
			(
				await tx.category.findMany({
					where: {
						id: {
							in: input.removed.flatMap((r) => (r.categoryId ? [r.categoryId] : [])),
						},
					},
					select: { id: true },
				})
			).map((c) => c.id),
		);
		await tx.splitParticipant.createMany({
			data: input.removed.map((r) => ({
				id: r.id,
				transactionId: input.transactionId,
				participantType: r.participantType,
				participantId: r.participantId,
				shareAmount: r.shareAmount,
				sharePercentage: r.sharePercentage,
				shareUnits: r.shareUnits,
				verificationStatus: r.verificationStatus,
				verifiedAt: r.verifiedAt ? new Date(r.verifiedAt) : null,
				rejectionReason: r.rejectionReason,
				hasUnseenChanges: r.hasUnseenChanges,
				categoryId: r.categoryId && kept.has(r.categoryId) ? r.categoryId : null,
				categorySource:
					r.categoryId && kept.has(r.categoryId) ? r.categorySource : null,
			})),
		});
		// Locked while it is read: an edit that commits after this check but before
		// ours would otherwise leave the share back on an expense that changed. An
		// edit still running makes this wait, and then it reads the new stamp.
		const [txn] = await tx.$queryRaw<
			{ updatedAt: Date; isLocked: boolean; projectId: string | null }[]
		>`SELECT "updatedAt", "isLocked", "projectId" FROM "shared_transaction" WHERE "id" = ${input.transactionId} FOR UPDATE`;
		if (!txn)
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Transaction not found or has been deleted",
			});
		if (txn.isLocked || txn.updatedAt.toISOString() !== input.expectedUpdatedAt)
			throw new TRPCError({
				code: "CONFLICT",
				message: "This expense changed since. Undo is no longer safe.",
			});
		await logAudit(tx, {
			actor: { participantType: "user", participantId: actor.userId },
			action: "PARTICIPANT_ADDED",
			targetType: "SPLIT_PARTICIPANT",
			targetId: input.transactionId,
			changes: {
				participantType: "user",
				participantId: actor.userId,
				restoredSplitIds: input.removed.map((r) => r.id),
				selfRestored: true,
			},
			projectId: txn.projectId ?? undefined,
		});
		return {
			value: {
				transactionId: input.transactionId,
				restored: input.removed.length,
			},
			undo: {
				kind: "revert",
				mutation: "sharedExpense.removeSelf",
				rows: input.removed.map((r) => ({ table: "split_participant", id: r.id })),
			},
		};
	},
};
