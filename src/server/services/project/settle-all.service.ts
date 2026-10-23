/**
 * What the Settle all procedures do: preview and apply project.settleAll
 * through the preview runner (one code path, R30), the notifications a
 * preview cannot send, and Undo (project.settleAllUndo, all or none).
 */
import { TRPCError } from "@trpc/server";
import { forUser } from "~/server/services/preview";
import { SettlementService } from "~/server/services/shared-expenses/settlement.service";
import type { PrismaClient } from "~prisma";
import { type PlannedLine, settleAllInProject } from "./settle-all.mutation";
import { undoSettleAllInProject } from "./settle-all-undo.mutation";

export const previewSettleAll = (
	userId: string,
	projectId: string,
	timeZone?: string,
) => forUser(userId).preview(settleAllInProject, { projectId, timeZone });

/** Records the lines the preview showed (`expect`); CONFLICT when they moved. */
export async function applySettleAll(
	db: PrismaClient,
	userId: string,
	input: { projectId: string; expect: readonly PlannedLine[] },
	timeZone?: string,
) {
	const result = await forUser(userId).apply(settleAllInProject, {
		...input,
		timeZone,
	});
	if (result.value.lines.length === 0) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "There is nothing to record in this project.",
		});
	}
	const service = new SettlementService(db, userId);
	for (const line of result.value.lines)
		await service.notifyPaymentRecorded(line.paymentId);
	return result;
}

/** Takes back the payments one Settle all wrote, all or none, in this project only. */
export const undoSettleAll = (
	userId: string,
	input: { projectId: string; paymentIds: readonly string[] },
) => forUser(userId).apply(undoSettleAllInProject, input);
