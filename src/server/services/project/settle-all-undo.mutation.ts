/**
 * project.settleAllUndo: takes back the payments one Settle all wrote, all
 * or none, in one transaction. A payment still waiting for the other person
 * is deleted; one that was final at once (they paid you, or a person not on
 * Retrospend) is voided: the same rules as the payment's own Delete and
 * Void (settlement-groups.ts groupRoles). If any one of them can no longer
 * be undone (the other person confirmed it), nothing changes and the undo
 * says so. Only payments of this project are taken back.
 */
import { TRPCError } from "@trpc/server";
import type { FigureDb } from "~/server/figures/registry";
import { logGroupAction } from "~/server/services/payments/write";
import type { MoneyMutation } from "~/server/services/preview/types";
import { reopenUnsettledPeriods } from "~/server/services/shared-expenses/billing-period-settle";
import { groupRoles } from "~/server/services/shared-expenses/settlement-groups";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";

export interface SettleAllUndoInput {
	readonly projectId: string;
	readonly paymentIds: readonly string[];
}

type Tx = FigureDb;

async function groupOf(tx: Tx, projectId: string, paymentId: string) {
	const rows = await tx.settlement.findMany({
		where: { paymentGroupId: paymentId },
	});
	if (rows.length === 0 || rows.some((r) => r.projectId !== projectId)) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "That payment is not in this project",
		});
	}
	return rows;
}

export const undoSettleAllInProject: MoneyMutation<
	SettleAllUndoInput,
	{ undone: number }
> = {
	id: "project.settleAllUndo",
	touches: ["project.total", "owed.owedToYou", "owed.youOwe"],
	scope: (input) => ({ projectId: input.projectId }),
	run: async (tx, input, actor) => {
		const me: ParticipantRef = {
			participantType: "user",
			participantId: actor.userId,
		};
		const ids = [...new Set(input.paymentIds)];
		const groups = [];
		// Check every payment first: one that cannot be undone stops them all.
		for (const id of ids) {
			const rows = await groupOf(tx, input.projectId, id);
			const roles = groupRoles(rows, actor.userId);
			const pending = roles.status === "PROPOSED" && roles.recordedByMe;
			if (!pending && !roles.canVoid) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "A payment was confirmed meanwhile, so it cannot be undone",
				});
			}
			groups.push({ rows, pending });
		}
		for (const { rows, pending } of groups) {
			const statuses = pending
				? (["PROPOSED", "REJECTED"] as const)
				: (["FINALIZED"] as const);
			const { count } = await tx.settlement.deleteMany({
				where: {
					id: { in: rows.map((r) => r.id) },
					status: { in: [...statuses] },
				},
			});
			if (count !== rows.length) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "A payment was changed meanwhile",
				});
			}
			await logGroupAction(tx, me, rows, {
				action: "DELETED",
				context: pending ? "settlement_deleted" : "settlement_voided",
				changes: { status: rows[0]?.status, undoOf: "project.settleAll" },
			});
		}
		await tx.payment.deleteMany({ where: { id: { in: ids } } });
		await reopenUnsettledPeriods(tx, [input.projectId], me, {
			reason: "settlement_deleted",
			settlementIds: groups.flatMap((g) => g.rows.map((r) => r.id)),
		});
		return {
			value: { undone: groups.length },
			undo: { kind: "revert", mutation: "project.settleAllUndo", rows: [] },
		};
	},
};
