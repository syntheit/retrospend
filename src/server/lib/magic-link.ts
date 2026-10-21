import { TRPCError } from "@trpc/server";

/**
 * Validates a project invite (magic) link. Throws NOT_FOUND for every invalid
 * state (revoked / expired / max uses) so callers can't enumerate links.
 *
 * `allowUsedUp` skips the max-uses check. Use it only for follow-up steps of a
 * registration that already consumed a use (for example linking a guest who
 * just joined through a single-use link to a ghost); revocation and expiry
 * still apply.
 */
export function validateLinkOrThrow(
	link: {
		isActive: boolean;
		expiresAt: Date | null;
		maxUses: number | null;
		useCount: number;
	},
	options: { allowUsedUp?: boolean } = {},
): void {
	if (!link.isActive) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "This invite link is no longer valid",
		});
	}
	if (link.expiresAt !== null && link.expiresAt < new Date()) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "This invite link is no longer valid",
		});
	}
	if (
		!options.allowUsedUp &&
		link.maxUses !== null &&
		link.useCount >= link.maxUses
	) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "This invite link is no longer valid",
		});
	}
}
