/**
 * Deleting a split that payments already covered (D12, S17): "Void the
 * payment" removes the payments that covered it, in the same transaction
 * as the delete, so nobody is left owing the other way round.
 *
 * For each participant whose balance with the payer would flip once their
 * share is gone, the payments from them to the payer in the split's
 * currency and project are voided newest first, until the balance no longer
 * flips. A payment group is voided whole (MONEY-MOVES §1.1: its rows go
 * together), and only when you may void it: a pending one you recorded,
 * or one auto-finalized without the other side's agreement
 * (groupRoles.canVoid). Otherwise the delete is refused and "Keep the
 * credit" stays the choice. Like voidAutoFinalizedSettlement, each void is
 * logged on the group and reopens the billing periods it had settled.
 */
import { TRPCError } from "@trpc/server";
import { toMinor } from "~/server/services/envelope/units";
import type { Prisma, PrismaClient } from "~prisma";
import { logGroupAction } from "../payments/write";
import { computeBalance } from "./balance";
import { reopenUnsettledPeriods } from "./billing-period-settle";
import { groupRoles } from "./settlement-groups";
import type { ParticipantRef } from "./types";
import { sameParticipant } from "./types";

type Tx = Prisma.TransactionClient;

export type SettledChoice = "KEEP_CREDIT" | "VOID_PAYMENT";

export interface CoveredSplit {
	currency: string;
	projectId: string | null;
	paidByType: string;
	paidById: string;
	splitParticipants: ReadonlyArray<{
		participantType: string;
		participantId: string;
		shareAmount: Prisma.Decimal | number;
	}>;
}

const refOf = (type: string, id: string): ParticipantRef => ({
	participantType: type as ParticipantRef["participantType"],
	participantId: id,
});

/** Payment groups to void so no participant's balance flips once the split is gone. */
async function coveringGroups(
	tx: Tx,
	split: CoveredSplit,
): Promise<Set<string>> {
	const payer = refOf(split.paidByType, split.paidById);
	const groups = new Set<string>();
	for (const sp of split.splitParticipants) {
		const who = refOf(sp.participantType, sp.participantId);
		if (sameParticipant(who, payer)) continue;
		const { byCurrency } = await computeBalance(
			tx as unknown as PrismaClient,
			payer,
			who,
			{ projectScope: split.projectId },
		);
		let after =
			toMinor(String(byCurrency[split.currency] ?? 0), split.currency) -
			toMinor(sp.shareAmount.toString(), split.currency);
		if (after >= 0) continue;
		const payments = await tx.settlement.findMany({
			where: {
				fromParticipantType: who.participantType,
				fromParticipantId: who.participantId,
				toParticipantType: payer.participantType,
				toParticipantId: payer.participantId,
				currency: split.currency,
				projectId: split.projectId,
				kind: "PAYMENT",
				isOffset: false,
				status: { in: ["FINALIZED", "PROPOSED"] },
			},
			orderBy: [{ initiatedAt: "desc" }, { id: "desc" }],
			select: { amount: true, paymentGroupId: true },
		});
		for (const p of payments) {
			if (after >= 0) break;
			if (!p.paymentGroupId || groups.has(p.paymentGroupId)) continue;
			groups.add(p.paymentGroupId);
			after += toMinor(p.amount.toString(), split.currency);
		}
	}
	return groups;
}

/** Voids the payments that covered the split; refuses one only both sides can undo. */
export async function voidCoveringPayments(
	tx: Tx,
	split: CoveredSplit,
	actorUserId: string,
): Promise<string[]> {
	const groups = [...(await coveringGroups(tx, split))];
	if (groups.length === 0) return [];
	const rows = await tx.settlement.findMany({
		where: { paymentGroupId: { in: groups } },
	});
	for (const id of groups) {
		const roles = groupRoles(
			rows.filter((r) => r.paymentGroupId === id),
			actorUserId,
		);
		const mine = roles.status === "PROPOSED" && roles.recordedByMe;
		if (!(roles.isParty && (mine || roles.canVoid)))
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message:
					"That payment can only be undone by both of you. Keep the credit instead.",
			});
	}
	await tx.settlement.deleteMany({ where: { paymentGroupId: { in: groups } } });
	await tx.payment.deleteMany({ where: { id: { in: groups } } });
	const actor = refOf("user", actorUserId);
	for (const id of groups) {
		const group = rows.filter((r) => r.paymentGroupId === id);
		await logGroupAction(tx, actor, group, {
			action: "DELETED",
			context: "settlement_voided",
			changes: {
				status: groupRoles(group, actorUserId).status,
				autoConfirmedReason: group[0]?.autoConfirmedReason,
				initiatedAt: group[0]?.initiatedAt.toISOString(),
			},
		});
	}
	await reopenUnsettledPeriods(
		tx,
		rows.map((r) => r.projectId),
		actor,
		{ reason: "settlement_voided", settlementIds: rows.map((r) => r.id) },
	);
	return groups;
}
