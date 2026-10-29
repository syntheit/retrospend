/**
 * Deleting a split must never silently change who owes whom. It cascades
 * its split rows away, so any balance it created disappears from
 * computeBalance (only the audit log keeps a trace). So a delete that
 * erases an unpaid debt, or turns payments already recorded for it into a
 * debt the other way round, needs a choice (D12):
 *
 * - `true` (or `{ confirmUnsettled: true }`): delete anyway;
 * - `settled: "KEEP_CREDIT"`: the payments stay, as a credit;
 * - `settled: "VOID_PAYMENT"`: the payments that covered it are voided in
 *   the same transaction (void-covering.ts).
 */
import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient } from "~prisma";
import {
	effectOfRemovingShare,
	type ShareRemovalEffect,
} from "./balance-change";
import type { ParticipantRef } from "./types";
import {
	type CoveredSplit,
	type SettledChoice,
	voidCoveringPayments,
} from "./void-covering";

export type DeleteOptions =
	| boolean
	| { confirmUnsettled?: boolean; settled?: SettledChoice };

type Tx = Prisma.TransactionClient;

/**
 * The strongest effect deleting this expense has on the balance between
 * its payer and any participant they covered (see
 * {@link effectOfRemovingShare}): "flips_balance" when a recorded payment
 * would become a debt the other way round, else "erases_debt" when someone
 * still owes the payer, else "none".
 */
async function deletionEffect(
	db: PrismaClient,
	existing: CoveredSplit,
): Promise<ShareRemovalEffect> {
	const payer: ParticipantRef = {
		participantType: existing.paidByType as "user" | "guest" | "shadow",
		participantId: existing.paidById,
	};
	const TOLERANCE = 0.005;
	let strongest: ShareRemovalEffect = "none";
	for (const sp of existing.splitParticipants) {
		// The payer's own share is not a debt.
		if (
			sp.participantType === payer.participantType &&
			sp.participantId === payer.participantId
		)
			continue;
		// This participant contributes debt only if they were charged a share.
		const share = Number(sp.shareAmount);
		if (share <= TOLERANCE) continue;
		const effect = await effectOfRemovingShare(db, {
			payer,
			participant: {
				participantType: sp.participantType as "user" | "guest" | "shadow",
				participantId: sp.participantId,
			},
			share,
			currency: existing.currency,
			projectId: existing.projectId,
		});
		if (effect === "flips_balance") return effect;
		if (effect === "erases_debt") strongest = effect;
	}
	return strongest;
}

/** Refuses a delete that changes who owes whom without a choice; applies VOID_PAYMENT. */
export async function guardDelete(
	tx: Tx,
	existing: CoveredSplit,
	actor: ParticipantRef,
	options: DeleteOptions,
): Promise<void> {
	const { confirmUnsettled = false, settled } =
		typeof options === "boolean" ? { confirmUnsettled: options } : options;
	if (settled === "VOID_PAYMENT") {
		if (actor.participantType !== "user")
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Only a signed-in person can void a payment",
			});
		await voidCoveringPayments(tx, existing, actor.participantId);
		return;
	}
	if (confirmUnsettled || settled) return;
	const effect = await deletionEffect(tx as unknown as PrismaClient, existing);
	if (effect === "flips_balance")
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"Payments or other expenses already cover this expense, so deleting it would leave the payer owing money. Confirm to delete anyway.",
		});
	if (effect === "erases_debt")
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"This expense still has an unsettled balance between participants. Deleting it removes that debt. Confirm to delete anyway.",
		});
}
