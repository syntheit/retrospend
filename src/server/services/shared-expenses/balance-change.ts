import type { PrismaClient } from "~prisma";
import { computeBalance } from "./balance";
import type { ParticipantRef } from "./types";

const TOLERANCE = 0.005;

/**
 * What happens to the balance between an expense's payer and one participant
 * when that participant's share of the expense disappears (the expense is
 * deleted, or the participant removes themselves from it).
 *
 * - "flips_balance": what the participant still owes the payer is less than
 *   the share, because payments already recorded (or other expenses) cover
 *   it. Removing the share leaves the payer owing the participant: a payment
 *   for this expense turns into a debt the other way round.
 * - "erases_debt": the participant still owes the payer at least the share,
 *   and that unpaid debt disappears.
 * - "none": the share is zero (within rounding), nothing changes.
 *
 * Any non-zero share changes the balance, so it is always one of the first
 * two; callers decide which of them need the user to confirm.
 */
export type ShareRemovalEffect = "none" | "erases_debt" | "flips_balance";

/**
 * Works out {@link ShareRemovalEffect} from the live balance (computeBalance,
 * so settlements, claim aliases and rounding are honoured). A project expense
 * is checked against that project's balance (settlements are project-scoped);
 * a standalone expense against the global balance.
 */
export async function effectOfRemovingShare(
	db: PrismaClient,
	args: {
		payer: ParticipantRef;
		participant: ParticipantRef;
		share: number;
		currency: string;
		projectId: string | null;
	},
): Promise<ShareRemovalEffect> {
	if (args.share <= TOLERANCE) return "none";
	// computeBalance(payer, participant): positive = participant owes payer.
	// A payment still pending counts for one side only (I5); for this warning
	// it counts if either side recorded it, so a payment is never missed.
	const views = await Promise.all(
		[args.payer, args.participant].map((viewer) =>
			computeBalance(db, args.payer, args.participant, {
				viewer,
				...(args.projectId ? { projectScope: args.projectId } : {}),
			}),
		),
	);
	const owed = Math.min(
		...views.map((balance) => balance.byCurrency[args.currency] ?? 0),
	);
	if (owed - args.share < -TOLERANCE) return "flips_balance";
	if (owed > TOLERANCE) return "erases_debt";
	return "none";
}
