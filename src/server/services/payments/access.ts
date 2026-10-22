/**
 * Who may record a payment with whom, and the pair lock. Every function
 * takes the open transaction, so a preview reads and locks exactly what the
 * write would (mutation files may not reach the global db).
 */
import { TRPCError } from "@trpc/server";
import { resolveClaimAliases } from "~/server/services/shared-expenses/identity";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import type { Prisma, PrismaClient } from "~prisma";

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Serializes payment writes between `me` and `other`: taken first in the
 * transaction that reads the balance and writes rows, a second concurrent
 * payment between the same two people waits until the first commits, so its
 * balance read sees it and the over-payment cap holds. Keyed on the
 * unordered pair, so payments in either direction share one lock; released
 * on commit or rollback.
 */
export async function lockPair(
	tx: Pick<PrismaClient, "$executeRaw">,
	me: ParticipantRef,
	other: ParticipantRef,
): Promise<void> {
	const pairKey = [
		`${me.participantType}:${me.participantId}`,
		`${other.participantType}:${other.participantId}`,
	]
		.sort()
		.join("|");
	await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('settlement-pair'), hashtext(${pairKey}))`;
}

/** `me` and `ref` must share at least one expense (and a shadow must exist). */
export async function assertRelationship(
	tx: Tx,
	me: ParticipantRef,
	ref: ParticipantRef,
): Promise<void> {
	if (ref.participantType === "shadow") {
		const profile = await tx.shadowProfile.findUnique({
			where: { id: ref.participantId },
			select: { id: true },
		});
		if (!profile) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
		}
	}

	const count = await tx.sharedTransaction.count({
		where: {
			AND: [
				{ splitParticipants: { some: me } },
				{
					splitParticipants: {
						some: {
							participantType: ref.participantType,
							participantId: ref.participantId,
						},
					},
				},
			],
		},
	});

	if (!count) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "No financial relationship found with this person",
		});
	}
}

/**
 * A client-supplied project must be one `me` is or was part of: a current
 * participant, or the payer or a split member of one of its expenses (claim
 * aliases count). Removing someone from a project keeps their expenses and
 * balances, and they must still be able to settle those. The counterparty
 * needs no check: a balance between the two in the project only exists if
 * both have history in it.
 */
export async function assertProjectInvolvement(
	tx: Tx,
	me: ParticipantRef,
	projectId: string,
): Promise<void> {
	const { aliasesByKey } = await resolveClaimAliases(tx, [me]);
	const myRefs = aliasesByKey.get(
		`${me.participantType}:${me.participantId}`,
	) ?? [me];
	const refConds = myRefs.map((r) => ({
		participantType: r.participantType,
		participantId: r.participantId,
	}));

	const members = await tx.projectParticipant.findMany({
		where: { projectId, OR: refConds },
		select: { id: true },
		take: 1,
	});
	if (members.length > 0) return;

	const involvedExpenses = await tx.sharedTransaction.count({
		where: {
			projectId,
			OR: [
				...refConds.map((r) => ({
					paidByType: r.participantType,
					paidById: r.participantId,
				})),
				...refConds.map((r) => ({ splitParticipants: { some: r } })),
			],
		},
	});
	if (involvedExpenses > 0) return;

	throw new TRPCError({
		code: "FORBIDDEN",
		message: "You are not part of this project",
	});
}
