import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { env } from "~/env";
import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import { db as globalDb } from "~/server/db";
import { signClaimToken, verifyClaimToken } from "~/lib/claim-token";
import { requireProjectRole } from "~/server/services/shared-expenses/project-permissions";
import {
	AlreadyClaimedError,
	claimShadowProfile,
	listUnclaimedProjectGhosts,
	mergeShadowIntoGuest,
} from "~/server/services/claim.service";

/** Verifies a claim token and turns verification failures into tRPC errors. */
function decodeTokenOrThrow(token: string): string {
	const result = verifyClaimToken(token, env.BETTER_AUTH_SECRET);
	if (!result.valid) {
		throw new TRPCError({
			code: result.reason === "expired" ? "BAD_REQUEST" : "NOT_FOUND",
			message:
				result.reason === "expired"
					? "This claim link has expired"
					: "This claim link is not valid",
		});
	}
	return result.shadowId;
}

export const claimRouter = createTRPCRouter({
	/**
	 * Organizer action: mint a signed claim link for a ghost. The caller must be
	 * able to see the shadow (RLS: creator or shares a project with it), so we
	 * read it through the user-scoped ctx.db — an unrelated user gets NOT_FOUND.
	 *
	 * A claim link grants the holder the shadow's identity (and, on claim, project
	 * access), so minting one is a privileged action: the caller must be an
	 * EDITOR or ORGANIZER of at least one project the shadow participates in. A
	 * mere VIEWER/CONTRIBUTOR — or someone who only shares an unrelated project —
	 * cannot mint a link. (Mirrors how addParticipant authorizes with EDITOR+.)
	 */
	generateLink: protectedProcedure
		.input(z.object({ shadowId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			const shadow = await ctx.db.shadowProfile.findUnique({
				where: { id: input.shadowId },
				select: { id: true, name: true, claimedById: true, createdById: true },
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

			// The shadow's project memberships determine where the caller must hold
			// EDITOR+. Require EDITOR+ in at least ONE of them.
			const shadowMemberships = await ctx.db.projectParticipant.findMany({
				where: { participantType: "shadow", participantId: shadow.id },
				select: { projectId: true },
			});
			// A shadow with no project memberships is a standalone contact and grants
			// no project access when claimed; its creator may still mint a link.
			let authorized =
				shadowMemberships.length === 0 && shadow.createdById === userId;
			for (const m of shadowMemberships) {
				if (authorized) break;
				try {
					await requireProjectRole(
						ctx.db,
						m.projectId,
						"user",
						userId,
						"EDITOR",
					);
					authorized = true;
					break;
				} catch {
					// Not EDITOR+ (or not a member) of this project — keep checking.
				}
			}
			if (!authorized) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message:
						"Only an editor or organizer of this person's project can generate a claim link",
				});
			}

			const token = signClaimToken(shadow.id, env.BETTER_AUTH_SECRET);
			// Build an ABSOLUTE URL the recipient can open from anywhere. On the
			// server the canonical base is PUBLIC_URL; fall back to the client var
			// (which also maps to PUBLIC_URL at runtime). Mirrors email-templates.ts.
			const baseUrl = env.PUBLIC_URL ?? env.NEXT_PUBLIC_APP_URL;
			const url = `${baseUrl}/claim/${token}`;
			return { url, token, name: shadow.name };
		}),

	/**
	 * Public preview for the /claim/[token] page: "You've been added as {name}
	 * in {projects} — is this you?". Uses global db because the (possibly
	 * logged-out) viewer has no relationship to the shadow yet.
	 */
	info: publicProcedure
		.input(z.object({ token: z.string().min(1) }))
		.query(async ({ input }) => {
			const shadowId = decodeTokenOrThrow(input.token);

			const shadow = await globalDb.shadowProfile.findUnique({
				where: { id: shadowId },
				select: { id: true, name: true, claimedById: true },
			});
			if (!shadow) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "This claim link is not valid",
				});
			}

			const memberships = await globalDb.projectParticipant.findMany({
				where: { participantType: "shadow", participantId: shadowId },
				select: { projectId: true },
			});
			const projectIds = memberships.map((m) => m.projectId);
			const projects =
				projectIds.length > 0
					? await globalDb.project.findMany({
							where: { id: { in: projectIds } },
							select: { id: true, name: true },
						})
					: [];

			return {
				name: shadow.name,
				alreadyClaimed: shadow.claimedById !== null,
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
			const shadowId = decodeTokenOrThrow(input.token);
			try {
				const result = await claimShadowProfile(
					globalDb,
					shadowId,
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
				select: { projectId: true },
			});
			if (!link) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "This invite link is not valid",
				});
			}
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
				select: { id: true, sessionToken: true, projectId: true },
			});
			if (!guestSession || guestSession.sessionToken !== hashed) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}

			// The ghost must belong to the same project the guest joined.
			const link = await globalDb.magicLink.findUnique({
				where: { id: input.linkId },
				select: { projectId: true },
			});
			if (!link || link.projectId !== guestSession.projectId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "This invite link is not valid",
				});
			}

			try {
				const { shadowName } = await mergeShadowIntoGuest(
					globalDb,
					input.shadowId,
					guestSession.id,
					guestSession.projectId,
				);
				return { name: shadowName };
			} catch (err) {
				if (err instanceof AlreadyClaimedError) {
					throw new TRPCError({ code: "CONFLICT", message: err.message });
				}
				throw err;
			}
		}),
});
