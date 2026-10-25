/**
 * Undo of a correction: deletes exactly the rows it wrote and reopens the fix
 * requests it answered. Only the latest correction of a split can be undone,
 * and only while no payment has settled on top of it.
 */
import { TRPCError } from "@trpc/server";
import type { UndoCorrectionInput } from "~/lib/schemas/corrections";
import type { Prisma } from "~prisma";
import { forgetMonthViews } from "../envelope/month-read";
import { logAudit } from "../shared-expenses/audit-log";
import { type Party, partyKey } from "./plan";
import { partyOf } from "./split-state";

type Tx = Prisma.TransactionClient;

interface UndoRow {
	readonly id: string;
	readonly correctsId: string | null;
	readonly createdAt: Date;
	readonly isLocked: boolean;
	readonly projectId: string | null;
	readonly paidByType: Party["participantType"];
	readonly paidById: string;
	readonly splitParticipants: readonly {
		participantType: Party["participantType"];
		participantId: string;
	}[];
}

const conflict = (message: string) =>
	new TRPCError({ code: "CONFLICT", message });

/**
 * Only the latest correction of a split can be undone, and only while nothing
 * has settled on top of it: a later correction was planned from this one, and
 * a payment since was allocated against the balance it reopened. Undoing
 * either would leave that money unexplained (2C.2).
 */
async function assertUndoable(tx: Tx, rows: readonly UndoRow[]) {
	const original = rows[0]?.correctsId;
	if (!original || rows.some((r) => r.correctsId !== original || r.isLocked))
		throw conflict("That correction is settled and can no longer be undone");
	const since = new Date(Math.max(...rows.map((r) => r.createdAt.getTime())));
	const later = await tx.sharedTransaction.count({
		where: {
			correctsId: original,
			id: { notIn: rows.map((r) => r.id) },
			createdAt: { gte: since },
		},
	});
	if (later > 0) throw conflict("Undo the latest correction first");
	const people = new Map<string, Party>();
	for (const r of rows) {
		for (const p of [
			partyOf(r.paidByType, r.paidById),
			...r.splitParticipants.map((s) =>
				partyOf(s.participantType, s.participantId),
			),
		])
			people.set(partyKey(p), p);
	}
	const match = (type: "payer" | "payee") =>
		[...people.values()].map((p) => ({
			[`${type}Type`]: p.participantType,
			[`${type}Id`]: p.participantId,
		}));
	const settled = await tx.payment.count({
		where: {
			createdAt: { gte: since },
			status: { not: "REJECTED" },
			AND: [{ OR: match("payer") }, { OR: match("payee") }],
			settlements: { some: { projectId: rows[0]?.projectId ?? null } },
		},
	});
	if (settled > 0)
		throw conflict(
			"A payment was recorded after this correction, so it can no longer be undone",
		);
}

/** Deletes exactly the rows a correction wrote and reopens the requests it answered. */
export async function undoCorrection(
	tx: Tx,
	userId: string,
	input: UndoCorrectionInput,
): Promise<{ transactionIds: string[] }> {
	const rows = await tx.sharedTransaction.findMany({
		where: { id: { in: input.transactionIds } },
		select: {
			id: true,
			correctsId: true,
			createdAt: true,
			isLocked: true,
			createdByType: true,
			createdById: true,
			projectId: true,
			paidByType: true,
			paidById: true,
			splitParticipants: {
				select: { participantType: true, participantId: true },
			},
		},
	});
	const mine = rows.filter(
		(r) =>
			r.correctsId !== null &&
			r.createdByType === "user" &&
			r.createdById === userId,
	);
	if (mine.length !== input.transactionIds.length) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "That correction is already undone",
		});
	}
	await assertUndoable(tx, mine);
	await tx.sharedTransaction.deleteMany({
		where: { id: { in: input.transactionIds } },
	});
	for (const r of input.resolvedRequests) {
		await tx.fixRequest.updateMany({
			where: { id: r.id, status: "FIXED" },
			data: {
				status: r.previousStatus,
				fixedById: null,
				...(r.previousStatus === "PENDING" ? { answeredAt: null } : {}),
			},
		});
	}
	const first = mine[0];
	await logAudit(tx, {
		actor: partyOf("user", userId),
		action: "CORRECTION_UNDONE",
		targetType: "SHARED_TRANSACTION",
		targetId: first?.correctsId as string,
		projectId: first?.projectId ?? undefined,
		changes: { correctionIds: input.transactionIds },
	});
	forgetMonthViews(tx);
	return { transactionIds: [...input.transactionIds] };
}
