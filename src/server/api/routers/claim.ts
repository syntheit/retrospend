import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { env } from "~/env";
import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import type { PrismaClient } from "~prisma";
import { db as globalDb } from "~/server/db";
import { signClaimToken, verifyClaimToken } from "~/lib/claim-token";
import { validateLinkOrThrow } from "~/server/lib/magic-link";
import { createNotification } from "~/server/services/notifications";
import {
	AlreadyClaimedError,
	canMintClaimLink,
	claimShadowProfile,
	GhostInOtherProjectsError,
	listUnclaimedProjectGhosts,
	mergeShadowIntoGuest,
} from "~/server/services/claim.service";

const INVALID_CLAIM_LINK = "This claim link is not valid";
const STALE_CLAIM_LINK =
	"This claim link is no longer valid. Ask for a new one.";

/**
 * Verifies a claim token and loads the shadow it points at, rejecting links
 * that no longer match the database:
 *   - the shadow is gone (claiming deletes it, so a used link is dead),
 *   - the shadow was edited after the link was minted (how a creator revokes),
 *   - the issuer no longer has the rights a claim grants.
 * A shadow that is already claimed is returned as-is so callers can report it.
 * Uses the global db: the caller may have no relationship to the shadow yet.
 */
async function resolveClaimTokenOrThrow(token: string) {
	const result = verifyClaimToken(token, env.BETTER_AUTH_SECRET);
	if (!result.valid) {
		throw new TRPCError({
			code: result.reason === "expired" ? "BAD_REQUEST" : "NOT_FOUND",
			message:
				result.reason === "expired"
					? "This claim link has expired"
					: INVALID_CLAIM_LINK,
		});
	}

	const shadow = await globalDb.shadowProfile.findUnique({
		where: { id: result.shadowId },
		select: {
			id: true,
			name: true,
			claimedById: true,
			createdById: true,
			updatedAt: true,
		},
	});
	if (!shadow) {
		throw new TRPCError({ code: "NOT_FOUND", message: INVALID_CLAIM_LINK });
	}
	if (shadow.claimedById) {
		return shadow;
	}
	if (shadow.updatedAt.getTime() !== result.version) {
		throw new TRPCError({ code: "NOT_FOUND", message: STALE_CLAIM_LINK });
	}
	if (!(await canMintClaimLink(globalDb, result.issuerId, shadow))) {
		throw new TRPCError({ code: "NOT_FOUND", message: STALE_CLAIM_LINK });
	}
	return shadow;
}

/**
 * Soft guardrail for the invite-chooser impersonation vector: when a guest who
 * joined via the project invite link claims an existing ghost (and silently
 * absorbs its balance), tell the project's organizers so they can review it.
 *
 * Notifies every ORGANIZER of the project (project_participant rows with role
 * ORGANIZER and participantType 'user'). The claimer is a guest, so it can never
 * be one of these user rows, but we still resolve names defensively. Fires one
 * notification per organizer and is best-effort: the caller wraps it so a
 * notification failure never breaks the claim.
 */
async function notifyGhostClaimedByGuest(
	db: PrismaClient,
	projectId: string,
	ghostName: string,
	guestName: string,
	guestSessionId: string,
	shadowId: string,
) {
	const project = await db.project.findUnique({
		where: { id: projectId },
		select: { name: true },
	});
	const projectName = project?.name ?? "a project";
	const displayGuestName = guestName?.trim() || "A guest";

	const organizers = await db.projectParticipant.findMany({
		where: { projectId, participantType: "user", role: "ORGANIZER" },
		select: { participantId: true },
	});

	for (const organizer of organizers) {
		await createNotification({
			userId: organizer.participantId,
			type: "PARTICIPANT_ADDED",
			title: `Someone identified as ${ghostName}`,
			body: `${displayGuestName} joined '${projectName}' and claimed the profile for ${ghostName}. Review it in the People tab if that is not right.`,
			data: { projectId, shadowName: ghostName, shadowId, guestSessionId },
		});
	}
}

export const claimRouter = createTRPCRouter({
	/**
	 * Organizer action: mint a signed claim link for a ghost. The caller must be
	 * able to see the shadow (RLS: creator or shares a project with it), so we
	 * read it through the user-scoped ctx.db — an unrelated user gets NOT_FOUND.
	 *
	 * A claim link grants the holder the shadow's identity and, on claim, a
	 * membership in EVERY project the shadow is in. So the caller must be an
	 * EDITOR or ORGANIZER of every one of those projects (see canMintClaimLink);
	 * a standalone shadow can only be shared by its creator. The same check runs
	 * again at claim time against the issuer recorded in the token.
	 */
	generateLink: protectedProcedure
		.input(z.object({ shadowId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			const shadow = await ctx.db.shadowProfile.findUnique({
				where: { id: input.shadowId },
				select: {
					id: true,
					name: true,
					claimedById: true,
					createdById: true,
					updatedAt: true,
				},
			});
			if (!shadow) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Person not found",
				});
			}
			if (shadow.claimedById) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "This person has already been linked to an account",
				});
			}

			if (!(await canMintClaimLink(ctx.db, userId, shadow))) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message:
						"Only an editor or organizer of every project this person is in can generate a claim link",
				});
			}

			const token = signClaimToken(
				{
					shadowId: shadow.id,
					version: shadow.updatedAt.getTime(),
					issuerId: userId,
				},
				env.BETTER_AUTH_SECRET,
			);
			// Build an ABSOLUTE URL the recipient can open from anywhere. On the
			// server the canonical base is PUBLIC_URL; fall back to the client var
			// (which also maps to PUBLIC_URL at runtime). Mirrors email-templates.ts.
			const baseUrl = env.PUBLIC_URL ?? env.NEXT_PUBLIC_APP_URL;
			const url = `${baseUrl}/claim/${token}`;
			return { url, token, name: shadow.name };
		}),

	/**
	 * Public preview for the /claim/[token] page: "Is this you, {name}?". Uses
	 * global db because the (possibly logged-out) viewer has no relationship to
	 * the shadow yet.
	 *
	 * Project names are only listed for a signed-in caller, who is about to
	 * confirm the claim and join those projects. A logged-out visitor holding a
	 * forwarded link only learns the ghost's name.
	 */
	info: publicProcedure
		.input(z.object({ token: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const shadow = await resolveClaimTokenOrThrow(input.token);
			const alreadyClaimed = shadow.claimedById !== null;

			let projects: Array<{ id: string; name: string }> = [];
			if (ctx.session?.user && !alreadyClaimed) {
				const memberships = await globalDb.projectParticipant.findMany({
					where: { participantType: "shadow", participantId: shadow.id },
					select: { projectId: true },
				});
				const projectIds = memberships.map((m) => m.projectId);
				projects =
					projectIds.length > 0
						? await globalDb.project.findMany({
								where: { id: { in: projectIds } },
								select: { id: true, name: true },
							})
						: [];
			}

			return {
				name: shadow.name,
				alreadyClaimed,
				projects,
			};
		}),

	/**
	 * Claims the ghost encoded in the token for the logged-in user. Reuses the
	 * shared claim service (stamps claimedById/claimedAt + promotes memberships);
	 * balances then merge automatically via the identity resolver. Guards against
	 * claiming a ghost already linked to someone else.
	 */
	claimByToken: protectedProcedure
		.input(z.object({ token: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const shadow = await resolveClaimTokenOrThrow(input.token);
			try {
				const result = await claimShadowProfile(
					globalDb,
					shadow.id,
					ctx.session.user.id,
				);
				return {
					name: result.shadowName,
					projectIds: result.projectIds,
					alreadyClaimed: result.alreadyClaimed,
				};
			} catch (err) {
				if (err instanceof AlreadyClaimedError) {
					throw new TRPCError({ code: "CONFLICT", message: err.message });
				}
				throw err;
			}
		}),

	/**
	 * Lists a project's unclaimed ghosts for the "are you one of these people?"
	 * chooser shown right after a guest joins via a magic link. Validated by
	 * magicLinkId so it is safe to call before the guest is authenticated.
	 */
	projectGhosts: publicProcedure
		.input(z.object({ linkId: z.string().min(1) }))
		.query(async ({ input }) => {
			const link = await globalDb.magicLink.findUnique({
				where: { id: input.linkId },
				select: {
					projectId: true,
					isActive: true,
					expiresAt: true,
					maxUses: true,
					useCount: true,
				},
			});
			if (!link) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "This invite link is not valid",
				});
			}
			// Revoked, expired or used-up links reveal nothing, same as validateLink.
			validateLinkOrThrow(link);
			return listUnclaimedProjectGhosts(globalDb, link.projectId);
		}),

	/**
	 * Links a just-registered guest session to an existing project ghost (chooser
	 * on join). The guest absorbs the ghost's history so no duplicate is created.
	 * Authorised by proving ownership of the guest session token.
	 */
	linkGuestToGhost: publicProcedure
		.input(
			z.object({
				linkId: z.string().min(1),
				guestSessionId: z.string().min(1),
				shadowId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// Verify the caller owns the guest session they claim to be.
			const guestToken = ctx.headers.get("x-guest-token");
			if (!guestToken) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			const { createHash } = await import("node:crypto");
			const hashed = createHash("sha256").update(guestToken).digest("hex");
			const guestSession = await globalDb.guestSession.findUnique({
				where: { id: input.guestSessionId },
				select: {
					id: true,
					name: true,
					sessionToken: true,
					projectId: true,
				},
			});
			if (!guestSession || guestSession.sessionToken !== hashed) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}

			// The ghost must belong to the same project the guest joined.
			const link = await globalDb.magicLink.findUnique({
				where: { id: input.linkId },
				select: {
					projectId: true,
					isActive: true,
					expiresAt: true,
					maxUses: true,
					useCount: true,
				},
			});
			if (!link || link.projectId !== guestSession.projectId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "This invite link is not valid",
				});
			}
			// The link must still be live. Its last use may have been the guest's
			// own registration a moment ago, so a used-up link is fine here.
			validateLinkOrThrow(link, { allowUsedUp: true });

			// Absorbing a ghost rewrites shared history, so the guest must be a
			// current member who can contribute. Viewers, and guests an organizer
			// already removed, cannot take over a ghost.
			const guestMembership = await globalDb.projectParticipant.findUnique({
				where: {
					projectId_participantType_participantId: {
						projectId: guestSession.projectId,
						participantType: "guest",
						participantId: guestSession.id,
					},
				},
				select: { role: true },
			});
			if (!guestMembership || guestMembership.role === "VIEWER") {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You can't link to an existing person with this invite",
				});
			}

			try {
				const { shadowName } = await mergeShadowIntoGuest(
					globalDb,
					input.shadowId,
					guestSession.id,
					guestSession.projectId,
				);

				// Soft guardrail: tell the project's organizers that a link-holder
				// claimed (and absorbed) an existing ghost. Best-effort: a
				// notification failure must never fail the claim itself.
				try {
					await notifyGhostClaimedByGuest(
						globalDb,
						guestSession.projectId,
						shadowName,
						guestSession.name,
						guestSession.id,
						input.shadowId,
					);
				} catch (notifyErr) {
					console.error(
						"[Notification Error] ghost claimed via invite chooser:",
						notifyErr,
					);
				}

				return { name: shadowName };
			} catch (err) {
				if (err instanceof AlreadyClaimedError) {
					throw new TRPCError({ code: "CONFLICT", message: err.message });
				}
				if (err instanceof GhostInOtherProjectsError) {
					throw new TRPCError({ code: "FORBIDDEN", message: err.message });
				}
				throw err;
			}
		}),
});
