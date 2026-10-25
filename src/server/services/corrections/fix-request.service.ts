/**
 * Ask to fix (MONEY-MOVES 1.11): a person on a split asks the person who
 * added it to fix it. The creator accepts (and corrects or edits it, which
 * marks the request fixed) or declines; the asker can cancel. A split whose
 * creator is not on Retrospend cannot be asked: you are its only editor.
 *
 * Ids come from the client, so a retry returns the row it wrote. Every write
 * takes the caller's transaction (preview = dry run), queues its
 * notification for after the commit and carries only ids and the sender's
 * name (end-to-end encryption rule 3). The message and reply are the
 * people's own words, kept in their own columns and never read here.
 */
import { TRPCError } from "@trpc/server";
import type {
	AskToFixInput,
	CancelFixInput,
	FixRequestDto,
	FixRequestResult,
	LockStateDto,
	RespondToFixInput,
	RestoreFixInput,
} from "~/lib/schemas/corrections";
import type { FixRequest, FixRequestStatus, Prisma } from "~prisma";
import { logAudit } from "../shared-expenses/audit-log";
import { noticeSender } from "./notices";
import { partyOf } from "./split-state";

type Tx = Prisma.TransactionClient;
type Notify = (() => Promise<void>)[] | undefined;

const OPEN: FixRequestStatus[] = ["PENDING", "ACCEPTED"];

const fail = (code: TRPCError["code"], message: string) =>
	new TRPCError({ code, message });

export function fixRequestDto(r: FixRequest): FixRequestDto {
	return {
		id: r.id,
		transactionId: r.transactionId,
		requestedBy: { type: r.requestedByType, id: r.requestedById },
		asked: { type: r.askedType, id: r.askedId },
		message: r.message,
		reply: r.reply,
		status: r.status,
		createdAt: r.createdAt.toISOString(),
		updatedAt: r.updatedAt.toISOString(),
		answeredAt: r.answeredAt?.toISOString() ?? null,
	};
}

const result = (
	row: FixRequest,
	previousStatus: FixRequestStatus | null,
): FixRequestResult => ({
	request: fixRequestDto(row),
	previousStatus,
});

async function audit(
	tx: Tx,
	userId: string,
	action: "FIX_REQUESTED" | "FIX_ANSWERED",
	row: FixRequest,
	projectId: string | null,
	changes: Prisma.InputJsonValue,
) {
	await logAudit(tx, {
		actor: partyOf("user", userId),
		action,
		targetType: "SHARED_TRANSACTION",
		targetId: row.transactionId,
		projectId: projectId ?? undefined,
		changes,
	});
}

/** A retry of a request already written returns it; an id used for something else is refused. */
async function existing(tx: Tx, userId: string, input: AskToFixInput) {
	const row = await tx.fixRequest.findUnique({ where: { id: input.id } });
	if (!row) return null;
	if (
		row.requestedByType !== "user" ||
		row.requestedById !== userId ||
		row.transactionId !== input.transactionId
	) {
		throw fail("CONFLICT", "that id was already used for another change");
	}
	return row;
}

export async function askToFix(
	tx: Tx,
	userId: string,
	input: AskToFixInput,
	notify?: Notify,
): Promise<FixRequestResult> {
	const split = await tx.sharedTransaction.findUnique({
		where: { id: input.transactionId },
		select: {
			createdByType: true,
			createdById: true,
			correctsId: true,
			projectId: true,
		},
	});
	if (!split) throw fail("NOT_FOUND", "Expense not found");
	const again = await existing(tx, userId, input);
	if (again) return result(again, null);
	if (split.correctsId)
		throw fail("BAD_REQUEST", "Ask about the original expense");
	if (split.createdByType !== "user")
		throw fail(
			"BAD_REQUEST",
			"Only people on Retrospend can be asked to fix an expense",
		);
	if (split.createdById === userId)
		throw fail(
			"BAD_REQUEST",
			"You added this expense, so you can fix it yourself",
		);
	const open = await tx.fixRequest.count({
		where: {
			transactionId: input.transactionId,
			requestedByType: "user",
			requestedById: userId,
			status: { in: OPEN },
		},
	});
	if (open > 0)
		throw fail("CONFLICT", "You already asked for this to be fixed");
	const row = await tx.fixRequest.create({
		data: {
			id: input.id,
			transactionId: input.transactionId,
			requestedByType: "user",
			requestedById: userId,
			askedType: split.createdByType,
			askedId: split.createdById,
			message: input.message ?? null,
		},
	});
	await audit(tx, userId, "FIX_REQUESTED", row, split.projectId, {
		fixRequestId: row.id,
	});
	notify?.push(
		noticeSender({
			kind: "FIX_REQUESTED",
			to: split.createdById,
			from: userId,
			transactionId: input.transactionId,
			fixRequestId: row.id,
		}),
	);
	return result(row, null);
}

/** The request as `userId` may answer it: asked, and still waiting. */
async function waitingForMe(tx: Tx, userId: string, id: string) {
	const row = await tx.fixRequest.findUnique({ where: { id } });
	if (!row || row.askedType !== "user" || row.askedId !== userId)
		throw fail("NOT_FOUND", "No such request");
	return row;
}

export async function respondToFix(
	tx: Tx,
	userId: string,
	input: RespondToFixInput,
	notify?: Notify,
): Promise<FixRequestResult> {
	const row = await waitingForMe(tx, userId, input.id);
	if (row.status !== "PENDING")
		throw fail("CONFLICT", "That request was already answered");
	const status = input.response === "accept" ? "ACCEPTED" : "DECLINED";
	const updated = await tx.fixRequest.update({
		where: { id: row.id },
		data: { status, reply: input.reply ?? null, answeredAt: new Date() },
	});
	await audit(tx, userId, "FIX_ANSWERED", updated, null, {
		fixRequestId: row.id,
		status,
	});
	if (row.requestedByType === "user") {
		notify?.push(
			noticeSender({
				kind: status === "ACCEPTED" ? "FIX_ACCEPTED" : "FIX_DECLINED",
				to: row.requestedById,
				from: userId,
				transactionId: row.transactionId,
				fixRequestId: row.id,
			}),
		);
	}
	return result(updated, row.status);
}

async function mine(tx: Tx, userId: string, id: string) {
	const row = await tx.fixRequest.findUnique({ where: { id } });
	if (!row || row.requestedByType !== "user" || row.requestedById !== userId)
		throw fail("NOT_FOUND", "No such request");
	return row;
}

export async function cancelFixRequest(
	tx: Tx,
	userId: string,
	input: CancelFixInput,
): Promise<FixRequestResult> {
	const row = await mine(tx, userId, input.id);
	if (!OPEN.includes(row.status))
		throw fail("CONFLICT", "That request is already closed");
	const updated = await tx.fixRequest.update({
		where: { id: row.id },
		data: { status: "CANCELLED", answeredAt: new Date() },
	});
	return result(updated, row.status);
}

/** Undo of an ask: the request never existed. Only while nobody answered. */
export async function withdrawFixRequest(
	tx: Tx,
	userId: string,
	input: CancelFixInput,
): Promise<{ id: string }> {
	const row = await mine(tx, userId, input.id);
	if (row.status !== "PENDING")
		throw fail("CONFLICT", "That request was already answered");
	await tx.fixRequest.delete({ where: { id: row.id } });
	return { id: row.id };
}

/**
 * Undo of an answer (the asked person puts it back to waiting) or of a
 * cancel (the asker puts it back to what it was).
 */
export async function restoreFixRequest(
	tx: Tx,
	userId: string,
	input: RestoreFixInput,
): Promise<FixRequestResult> {
	const row = await tx.fixRequest.findUnique({ where: { id: input.id } });
	if (!row) throw fail("NOT_FOUND", "No such request");
	const asked = row.askedType === "user" && row.askedId === userId;
	const asker = row.requestedByType === "user" && row.requestedById === userId;
	const answered =
		asked &&
		input.status === "PENDING" &&
		["ACCEPTED", "DECLINED"].includes(row.status);
	const cancelled = asker && row.status === "CANCELLED";
	if (!answered && !cancelled)
		throw fail("CONFLICT", "That request cannot be put back");
	const updated = await tx.fixRequest.update({
		where: { id: row.id },
		data: {
			status: input.status,
			...(answered ? { reply: null } : {}),
			...(input.status === "PENDING" ? { answeredAt: null } : {}),
		},
	});
	return result(updated, row.status);
}

/** The requests on a split that the caller asked or was asked (nobody else sees them). */
export async function fixRequestsFor(
	tx: Tx,
	transactionId: string,
): Promise<FixRequestDto[]> {
	const rows = await tx.fixRequest.findMany({
		where: { transactionId },
		orderBy: [{ createdAt: "asc" }, { id: "asc" }],
	});
	return rows.map(fixRequestDto);
}

/** What each split allows the caller: the lock and who may correct or ask. */
export async function lockStates(
	tx: Tx,
	userId: string,
	transactionIds: readonly string[],
): Promise<LockStateDto[]> {
	const rows = await tx.sharedTransaction.findMany({
		where: { id: { in: [...transactionIds] } },
		select: {
			id: true,
			isLocked: true,
			lockedByPaymentId: true,
			correctsId: true,
			createdByType: true,
			createdById: true,
			_count: { select: { corrections: true } },
		},
	});
	return rows.map((r) => {
		const creator = r.createdByType === "user" && r.createdById === userId;
		return {
			transactionId: r.id,
			locked: r.isLocked,
			reason: !r.isLocked ? null : r.lockedByPaymentId ? "SETTLED" : "PERIOD",
			canCorrect: creator && r.isLocked && !r.correctsId,
			canAskToFix: !creator && r.createdByType === "user" && !r.correctsId,
			correctsId: r.correctsId,
			corrections: r._count.corrections,
		};
	});
}

/** A request to fix a split, answered by the creator's edit, with the status it had. */
export interface AnsweredFix {
	readonly id: string;
	readonly previousStatus: "PENDING" | "ACCEPTED";
}

/**
 * A plain edit of an unlocked split by the person asked to fix it answers
 * their open requests (FIXED); the undo of that edit puts them back. A
 * correction does the same for a settled split (correct.service.ts).
 */
export async function answerFixRequestsOnEdit(
	tx: Tx,
	userId: string,
	args: {
		readonly transactionId: string;
		readonly edited: boolean;
		readonly reopen?: readonly AnsweredFix[];
	},
): Promise<AnsweredFix[]> {
	if (args.reopen) {
		for (const r of args.reopen) {
			await tx.fixRequest.updateMany({
				where: {
					id: r.id,
					askedType: "user",
					askedId: userId,
					status: "FIXED",
				},
				data: {
					status: r.previousStatus,
					...(r.previousStatus === "PENDING" ? { answeredAt: null } : {}),
				},
			});
		}
		return [];
	}
	if (!args.edited) return [];
	const open = await tx.fixRequest.findMany({
		where: {
			transactionId: args.transactionId,
			askedType: "user",
			askedId: userId,
			status: { in: OPEN },
		},
		select: { id: true, status: true },
	});
	if (open.length === 0) return [];
	await tx.fixRequest.updateMany({
		where: { id: { in: open.map((r) => r.id) } },
		data: { status: "FIXED", answeredAt: new Date() },
	});
	return open.map((r) => ({
		id: r.id,
		previousStatus: r.status as "PENDING" | "ACCEPTED",
	}));
}
