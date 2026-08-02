import { type ParticipantRef, sameParticipant } from "./types";

/**
 * Resolves the verification status for a split participant on create/replace.
 *
 * Auto-accept is a PROJECT behavior, not a per-user preference: an expense's
 * project either accepts splits automatically or requires manual approval.
 * Standalone expenses (no project) have no approval gate, so callers pass
 * `true` and they always auto-accept.
 *
 * - The actor always ACCEPTED (they authored the change).
 * - A shadow (ghost) is ALWAYS AUTO_ACCEPTED, even in a manual-approval project:
 *   a ghost has no account or session, so it can never tap "accept". Leaving it
 *   PENDING would strand the split forever and block billing-period settlement.
 *   When the ghost is later claimed, the real user inherits the accepted split
 *   and can still dispute it.
 * - When the project auto-accepts, every other participant is AUTO_ACCEPTED too,
 *   skipping the manual approval gate entirely.
 * - Otherwise (manual project) real users and guests are PENDING, since they can
 *   actually approve.
 *
 * Shared by the create/update paths (transaction.service.ts) and the
 * rebalance-on-add path (project.ts) so all three resolve auto-accept
 * identically.
 */
export function resolveVerification(
	p: ParticipantRef,
	actor: ParticipantRef,
	projectAutoAccept: boolean,
): {
	status: "ACCEPTED" | "AUTO_ACCEPTED" | "PENDING";
	verifiedAt: Date | undefined;
} {
	if (sameParticipant(p, actor)) {
		return { status: "ACCEPTED", verifiedAt: new Date() };
	}
	if (projectAutoAccept || p.participantType === "shadow") {
		return { status: "AUTO_ACCEPTED", verifiedAt: new Date() };
	}
	return { status: "PENDING", verifiedAt: undefined };
}
