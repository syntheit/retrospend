/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */

import { createHash } from "node:crypto";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { auth } from "~/server/better-auth";
import type { Session } from "~/server/better-auth/config";
import { createUserScopedDb, db } from "~/server/db";
import type { ParticipantType } from "~prisma";

export type GuestParticipant = {
	participantType: Extract<ParticipantType, "guest">;
	participantId: string;
	projectScope: string;
};

export type UserParticipant = {
	participantType: Extract<ParticipantType, "user">;
	participantId: string;
};

/**
 * Anonymous viewer: authenticated solely by a valid VIEWER-role magic link.
 * No GuestSession is created; the link ID is validated on every request.
 */
export type ViewerLinkParticipant = {
	participantType: "viewerLink";
	participantId: string; // the MagicLink.id
	projectScope: string; // MagicLink.projectId
};

export type Participant = UserParticipant | GuestParticipant | ViewerLinkParticipant;

/** Participants that can perform write operations (CONTRIBUTOR+). */
export type WritableParticipant = UserParticipant | GuestParticipant;

/**
 * Narrows participant to a writable type, throwing FORBIDDEN for viewer-link
 * participants who only have read access.
 */
export function assertWritableParticipant(
	participant: Participant,
): WritableParticipant {
	if (participant.participantType === "viewerLink") {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Viewers cannot modify data",
		});
	}
	return participant;
}

/**
 * Assert that a guest's project scope matches the requested projectId.
 * No-op for user participants.
 */
export function assertGuestProjectScope(
	participant: Participant,
	projectId: string,
): void {
	if (
		(participant.participantType === "guest" ||
			participant.participantType === "viewerLink") &&
		participant.projectScope !== projectId
	) {
		throw new TRPCError({ code: "FORBIDDEN" });
	}
}

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
	const session = await auth.api.getSession({
		headers: opts.headers,
	});
	return {
		db,
		session,
		...opts,
	};
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
	transformer: superjson,
	errorFormatter({ shape, error }) {
		return {
			...shape,
			data: {
				...shape.data,
				zodError:
					error.cause instanceof ZodError ? error.cause.flatten() : null,
			},
		};
	},
});

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Middleware for timing procedure execution and adding an artificial delay in development.
 *
 * You can remove this if you don't like it, but it can help catch unwanted waterfalls by simulating
 * network latency that would occur in production but not in local development.
 */
const timingMiddleware = t.middleware(async ({ next }) => {
	const _start = Date.now();

	if (t._config.isDev) {
		// artificial delay in dev
		const waitMs = Math.floor(Math.random() * 400) + 100;
		await new Promise((resolve) => setTimeout(resolve, waitMs));
	}

	const result = await next();

	return result;
});

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid, the user is active, and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure
	.use(timingMiddleware)
	.use(async ({ ctx, next }) => {
		if (!ctx.session?.user) {
			throw new TRPCError({ code: "UNAUTHORIZED" });
		}

		// isActive is already present in the session from better-auth.
		// Session refreshes based on updateAge (24h). For immediate deactivation,
		// the admin endpoint should also delete the user's active sessions.
		if (!ctx.session.user.isActive) {
			throw new TRPCError({ code: "UNAUTHORIZED" });
		}

		const userDb = createUserScopedDb(ctx.session.user.id);

		return next({
			ctx: {
				// infers the `session` as non-nullable with additional user fields
				session: ctx.session as Session,
				db: userDb,
			},
		});
	});

/**
 * Admin procedure
 *
 * If you want a query or mutation to ONLY be accessible to admin users, use this. It verifies
 * the user is authenticated and has ADMIN role.
 */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
	if (ctx.session.user.role !== "ADMIN") {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}
	// Restore global db so admin queries run as superuser, bypassing RLS
	// for legitimate cross-user data access.
	return next({ ctx: { db } });
});

/**
 * Guest-or-protected procedure
 *
 * Accepts either a regular user session (same as protectedProcedure) or a
 * guest session token via the `x-guest-token` request header.
 *
 * Provides `ctx.participant` (discriminated union of user/guest) in addition
 * to `ctx.db`.
 *
 * - User callers: user-scoped db (RLS enforced), participant.participantType = "user"
 * - Guest callers: global db (RLS bypassed, app-level auth via assertGuestProjectScope),
 *   participant.participantType = "guest", participant.projectScope = the guest's project
 *
 * Procedures using this must call assertGuestProjectScope(ctx.participant, projectId)
 * before accessing any project data.
 */
export const guestOrProtectedProcedure = t.procedure
	.use(timingMiddleware)
	.use(async ({ ctx, next }) => {
		// Try regular user session first
		if (ctx.session?.user && ctx.session.user.isActive) {
			const userDb = createUserScopedDb(ctx.session.user.id);
			return next({
				ctx: {
					session: ctx.session as Session,
					db: userDb,
					participant: {
						participantType: "user" as const,
						participantId: ctx.session.user.id,
					} as Participant,
				},
			});
		}

		// No valid user session; check for guest token
		const guestToken = ctx.headers.get("x-guest-token");
		if (guestToken) {
			const hashedToken = createHash("sha256")
				.update(guestToken)
				.digest("hex");

			const guestSession = await ctx.db.guestSession.findUnique({
				where: { sessionToken: hashedToken },
			});

			if (guestSession) {
				// Enforce 90-day inactivity expiry.
				const GUEST_MAX_INACTIVE_MS = 90 * 24 * 60 * 60 * 1000;
				if (
					Date.now() - guestSession.lastActiveAt.getTime() <=
					GUEST_MAX_INACTIVE_MS
				) {
					// Update lastActiveAt (best-effort)
					await ctx.db.guestSession
						.update({
							where: { id: guestSession.id },
							data: { lastActiveAt: new Date() },
						})
						.catch(() => undefined);

					return next({
						ctx: {
							// Global db for guests: RLS bypassed; app-level auth
							// enforced by assertGuestProjectScope and requireProjectRole.
							db: ctx.db,
							session: undefined,
							participant: {
								participantType: "guest" as const,
								participantId: guestSession.id,
								projectScope: guestSession.projectId,
							} as Participant,
						},
					});
				}
			}
		}

		// No valid guest token; check for anonymous viewer link (VIEWER role only,
		// no registration required).
		const viewerLinkId = ctx.headers.get("x-viewer-link-id");
		if (viewerLinkId) {
			const link = await ctx.db.magicLink.findUnique({
				where: { id: viewerLinkId },
				select: {
					projectId: true,
					roleGranted: true,
					isActive: true,
					expiresAt: true,
					maxUses: true,
					useCount: true,
				},
			});

			if (link && link.isActive && link.roleGranted === "VIEWER") {
				const notExpired =
					!link.expiresAt || link.expiresAt.getTime() > Date.now();
				const notOverUsed =
					link.maxUses === null || link.useCount < link.maxUses;

				if (notExpired && notOverUsed) {
					return next({
						ctx: {
							db: ctx.db,
							session: undefined,
							participant: {
								participantType: "viewerLink" as const,
								participantId: viewerLinkId,
								projectScope: link.projectId,
							} as Participant,
						},
					});
				}
			}
		}

		throw new TRPCError({ code: "UNAUTHORIZED" });
	});
