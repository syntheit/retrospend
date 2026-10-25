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
		const { removed } = await removeSelfIn(
			tx,
			{ participantType: "user", participantId: actor.userId },
			input.transactionId,
			input.confirmBalanceChange ?? false,
		);
		const row = await tx.sharedTransaction.findUniqueOrThrow({
			where: { id: input.transactionId },
			select: { updatedAt: true },
		});
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
	run: async (tx, input) => {
		const txn = await tx.sharedTransaction.findUnique({
			where: { id: input.transactionId },
			select: { updatedAt: true, isLocked: true },
		});
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
