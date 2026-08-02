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
 * - A non-actor user participant is AUTO_ACCEPTED when the project auto-accepts,
 *   so the split skips the manual approval gate while still recording the
 *   change; otherwise PENDING.
 * - Guests and shadows can never approve splits, so they stay PENDING.
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
	if (p.participantType === "user" && projectAutoAccept) {
		return { status: "AUTO_ACCEPTED", verifiedAt: new Date() };
	}
	return { status: "PENDING", verifiedAt: undefined };
}
