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
 * - When the project auto-accepts, EVERY other participant is AUTO_ACCEPTED so
 *   the split skips the manual approval gate entirely. This includes guests and
 *   shadows: a ghost can never tap "accept", so leaving them PENDING would strand
 *   the whole expense in a perpetual pending state that auto-accept is meant to
 *   avoid.
 * - Otherwise (manual project) every non-actor participant is PENDING.
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
	if (projectAutoAccept) {
		return { status: "AUTO_ACCEPTED", verifiedAt: new Date() };
	}
	return { status: "PENDING", verifiedAt: undefined };
}
