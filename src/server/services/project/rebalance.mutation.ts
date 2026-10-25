/**
 * Folds a project member into existing expenses (the "Include them in past
 * expenses?" choice after adding someone). Runs entirely on the caller's
 * transaction, so it commits or rolls back as one unit.
 *
 * Only EQUAL expenses are recomputed, with the same split code as create, so
 * the result matches a fresh equal split. EXACT, PERCENTAGE and SHARES
 * amounts encode explicit intent and are never silently changed: they are
 * skipped and reported. Locked (settled) expenses are always skipped.
 *
 * RC-11: without `expenseIds` ("every eligible expense"), expenses dated
 * before the person joined (the day in the acting user's zone) are skipped as
 * `before_join`; they stay as they were saved. Chosen by id, they are
 * re-split: an editor picking one by hand is a deliberate choice.
 */
import { TRPCError } from "@trpc/server";
import {
	resolveSplits,
	type SplitParticipantRef,
} from "~/lib/shared-split-computation";
import { dayKey } from "~/lib/time-zone";
import { logAudit } from "~/server/services/shared-expenses/audit-log";
import { resolveVerification } from "~/server/services/shared-expenses/auto-accept";
import { resolveClaimAliases } from "~/server/services/shared-expenses/identity";
import { sameParticipant } from "~/server/services/shared-expenses/types";
import { userTimeZone } from "~/server/services/user-time-zone";
import type { ParticipantType, Prisma } from "~prisma";
import { joinedAfter, membershipOf } from "./membership";
import type { MemberRef, ProjectActor } from "./types";

export interface RebalanceInput extends MemberRef {
	projectId: string;
	/** Omit to target every eligible (EQUAL, unlocked) expense. */
	expenseIds?: string[];
}

export type RebalanceSkipReason =
	| "locked"
	| "already_included"
	| "non_equal_split"
	| "before_join";

export interface RebalanceResult {
	rebalancedCount: number;
	skipped: Array<{ id: string; reason: RebalanceSkipReason }>;
	rebalancedIds?: string[];
}

type Candidate = Awaited<ReturnType<typeof loadCandidates>>[number];

function loadCandidates(tx: Prisma.TransactionClient, input: RebalanceInput) {
	const ids =
		input.expenseIds && input.expenseIds.length > 0
			? { id: { in: input.expenseIds } }
			: {};
	return tx.sharedTransaction.findMany({
		where: { projectId: input.projectId, ...ids },
		select: {
			id: true,
			amount: true,
			currency: true,
			date: true,
			splitMode: true,
			isLocked: true,
			correctsId: true,
			_count: { select: { corrections: true } },
			paidByType: true,
			paidById: true,
			splitParticipants: {
				select: { participantType: true, participantId: true },
			},
		},
	});
}

/**
 * Decides which candidates to re-split. A claimed ghost and the user who
 * claimed it are one person, so adding the user to an expense that lists the
 * ghost would double count them: that counts as already included.
 */
async function pickExpenses(
	tx: Prisma.TransactionClient,
	input: RebalanceInput,
	candidates: Candidate[],
	beforeJoin: (date: Date) => boolean,
) {
	// Chosen by hand, an earlier expense is the user's call; "all eligible"
	// never reaches back before the person joined (RC-11).
	const byHand = Boolean(input.expenseIds && input.expenseIds.length > 0);
	const newcomer = {
		participantType: input.participantType,
		participantId: input.participantId,
	};
	const { canonicalKey } = await resolveClaimAliases(tx, [
		newcomer,
		...candidates.flatMap((e) => e.splitParticipants),
	]);
	const newcomerKey = canonicalKey(newcomer);

	const chosen: Candidate[] = [];
	const skipped: RebalanceResult["skipped"] = [];
	for (const e of candidates) {
		// A correction row, or a split with corrections, is never re-split (2C.2).
		if (e.isLocked || e.correctsId || (e._count?.corrections ?? 0) > 0) {
			skipped.push({ id: e.id, reason: "locked" });
		} else if (
			e.splitParticipants.some((sp) => canonicalKey(sp) === newcomerKey)
		) {
			skipped.push({ id: e.id, reason: "already_included" });
		} else if (e.splitMode !== "EQUAL") {
			skipped.push({ id: e.id, reason: "non_equal_split" });
		} else if (!byHand && beforeJoin(e.date)) {
			skipped.push({ id: e.id, reason: "before_join" });
		} else {
			chosen.push(e);
		}
	}
	return { chosen, skipped };
}

/**
 * Replaces every split row of `e` with the recomputed equal shares. Everyone's
 * share changed, so verification is resolved again per row: the actor stays
 * accepted; when the project auto-accepts, others are auto-accepted,
 * otherwise they wait for review.
 */
async function resplit(
	tx: Prisma.TransactionClient,
	e: Candidate,
	newcomer: MemberRef,
	actor: { participantType: "user"; participantId: string },
	autoAccept: boolean,
) {
	const shares = resolveSplits({
		mode: "EQUAL",
		amount: Number(e.amount),
		currency: e.currency,
		participants: [...e.splitParticipants, newcomer] as SplitParticipantRef[],
		paidBy: { participantType: e.paidByType, participantId: e.paidById },
	});
	await tx.splitParticipant.deleteMany({ where: { transactionId: e.id } });
	await tx.splitParticipant.createMany({
		data: shares.map((p) => {
			const ref = {
				participantType: p.participantType as ParticipantType,
				participantId: p.participantId,
			};
			const { status, verifiedAt } = resolveVerification(
				ref,
				actor,
				autoAccept,
			);
			return {
				transactionId: e.id,
				...ref,
				shareAmount: p.shareAmount,
				verificationStatus: status,
				verifiedAt,
				hasUnseenChanges: !sameParticipant(ref, actor),
			};
		}),
	});
}

/**
 * The caller must be an editor. The person must already be a project member;
 * new rows for others start as pending unless the project auto-accepts.
 */
export async function rebalanceExpenses(
	tx: Prisma.TransactionClient,
	{ userId, timeZone }: ProjectActor,
	input: RebalanceInput,
): Promise<RebalanceResult> {
	const actor = { participantType: "user" as const, participantId: userId };
	const newcomer: MemberRef = {
		participantType: input.participantType,
		participantId: input.participantId,
	};
	const membership = await tx.projectParticipant.findUnique({
		where: {
			projectId_participantType_participantId: {
				projectId: input.projectId,
				...newcomer,
			},
		},
		select: { id: true, joinedOn: true, leftOn: true },
	});
	if (!membership) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "That person is not a member of this project",
		});
	}

	const candidates = await loadCandidates(tx, input);
	const joined = membershipOf(membership);
	const zone = await userTimeZone(tx, userId, timeZone);
	const { chosen, skipped } = await pickExpenses(
		tx,
		input,
		candidates,
		(date) => joinedAfter(joined, dayKey(date, zone)),
	);
	if (chosen.length === 0) return { rebalancedCount: 0, skipped };

	// Auto-accept is decided by the project these expenses belong to.
	const project = await tx.project.findUnique({
		where: { id: input.projectId },
		select: { autoAcceptSplits: true },
	});
	const autoAccept = project?.autoAcceptSplits ?? true;
	for (const e of chosen) {
		await resplit(tx, e, newcomer, actor, autoAccept);
		await logAudit(tx, {
			actor,
			action: "EDITED",
			targetType: "SHARED_TRANSACTION",
			targetId: e.id,
			changes: { rebalanced: { addedParticipant: { ...newcomer } } },
			projectId: input.projectId,
		});
	}
	return {
		rebalancedCount: chosen.length,
		skipped,
		rebalancedIds: chosen.map((e) => e.id),
	};
}
