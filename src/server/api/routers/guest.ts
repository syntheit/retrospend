import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { env } from "~/env";
import {
	createTRPCRouter,
	guestOrProtectedProcedure,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import { db as globalDb } from "~/server/db";
import { notificationEmail } from "~/server/email-templates";
import { validateLinkOrThrow } from "~/server/lib/magic-link";
import { InMemoryRateLimiter, getClientIp } from "~/server/lib/rate-limiter";
import { hashToken } from "~/server/lib/tokens";
import { sendEmail } from "~/server/mailer";
import { joinProject } from "~/server/services/project/joining";
import { isEmailDeliveryEnabled } from "~/server/lib/email-delivery";
import {
	anonymizeParticipantReferences,
	DELETED_GUEST_SENTINEL,
} from "~/server/services/user-deletion.service";

const rateLimiter = new InMemoryRateLimiter();

/**
 * Resume links let a guest who already joined get back into their session on a
 * new device, after proving they own the email. They live in the
 * verification_token table (token stored hashed) under this identifier prefix
 * plus the guest session id and the invite link id.
 */
const GUEST_RESUME_PREFIX = "guest-resume:";
const GUEST_RESUME_TTL_MS = 60 * 60 * 1000; // 1 hour

function newGuestToken() {
	const raw = randomBytes(32).toString("hex");
	return { raw, hashed: createHash("sha256").update(raw).digest("hex") };
}

export const guestRouter = createTRPCRouter({

	/**
	 * Validates a magic link and returns safe project preview info.
	 * Returns NOT_FOUND for all invalid states to prevent enumeration.
	 */
	validateLink: publicProcedure
		.input(z.object({ linkId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const clientIp = getClientIp(ctx.headers);
			if (!rateLimiter.check(`guestValidate_${clientIp}`, 20, 60_000)) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "Rate limit exceeded",
				});
			}

			const link = await ctx.db.magicLink.findUnique({
				where: { id: input.linkId },
				include: {
					project: {
						select: {
							name: true,
							description: true,
							imagePath: true,
							_count: { select: { participants: true } },
						},
					},
				},
			});

			if (!link) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "This invite link is no longer valid",
				});
			}

			validateLinkOrThrow(link);

			return {
				projectId: link.projectId,
				projectName: link.project.name,
				projectDescription: link.project.description,
				projectImagePath: link.project.imagePath,
				participantCount: link.project._count.participants,
				roleGranted: link.roleGranted,
			};
		}),

	/**
	 * Registers a guest user via a magic link.
	 *
	 * - If the email already has a GuestSession for this project and email can
	 *   be sent, mails a one-time resume link to that address and returns
	 *   { resumeEmailSent: true } (no token: the caller hasn't proven they own
	 *   the email). Without email, a separate guest session is created instead.
	 * - A registered user's email is NOT special-cased (see below): signed-in
	 *   users join through joinWithAccount instead.
	 * - Otherwise creates a GuestSession and ProjectParticipant, increments
	 *   useCount, and returns the session token (unhashed) for the frontend to
	 *   store.
	 *
	 * Wrapped in a transaction to prevent duplicate guest sessions from
	 * concurrent registrations with the same email + project.
	 */
	register: publicProcedure
		.input(
			z.object({
				linkId: z.string().min(1),
				name: z.string().min(1).max(191),
				email: z.email().max(255),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const clientIp = getClientIp(ctx.headers);
			if (!rateLimiter.check(`guestRegister_${clientIp}`, 5, 60_000)) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "Rate limit exceeded",
				});
			}

			// Re-validate the link (could have been revoked between validateLink and register)
			const link = await ctx.db.magicLink.findUnique({
				where: { id: input.linkId },
				include: {
					project: { select: { id: true, name: true } },
				},
			});

			if (!link) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "This invite link is no longer valid",
				});
			}

			validateLinkOrThrow(link);

			const { projectId } = link;
			const email = input.email.toLowerCase().trim();

			// Deliberately no lookup of registered accounts here. The caller is
			// unauthenticated, so adding "the account with this email" to the
			// project would let anyone with an invite link enroll any user, and
			// answering differently for registered emails would reveal who has
			// an account. A registered person joins with their account through
			// joinWithAccount (signed in); typing their email here just makes a
			// plain guest, exactly like any other address.

			// The email may already have a guest session in this project (someone
			// rejoining from a new device). Nobody has proven they own that email,
			// so never hand out that session's token here: that would let anyone
			// who knows a guest's email take over their identity. Instead, when
			// email works, mail a one-time resume link to the address on file;
			// otherwise fall through and create a separate guest.
			const emailAvailable = await isEmailDeliveryEnabled();

			// Wrap guest session creation in a transaction to prevent duplicates
			// from concurrent registrations with the same email + project.
			const result = await ctx.db.$transaction(async (tx) => {
				// Re-check for existing session inside the transaction
				const existingSession = emailAvailable
					? await tx.guestSession.findFirst({
							where: { email, projectId },
						})
					: null;

				if (existingSession) {
					const resume = randomBytes(32).toString("hex");
					const identifier = `${GUEST_RESUME_PREFIX}${existingSession.id}:${link.id}`;
					// One live resume link per guest session.
					await tx.verificationToken.deleteMany({
						where: {
							identifier: {
								startsWith: `${GUEST_RESUME_PREFIX}${existingSession.id}:`,
							},
						},
					});
					await tx.verificationToken.create({
						data: {
							identifier,
							token: hashToken(resume),
							expires: new Date(Date.now() + GUEST_RESUME_TTL_MS),
						},
					});

					return {
						kind: "resume" as const,
						resumeToken: resume,
						sendTo: existingSession.email,
					};
				}

				// Create a new guest session
				const { raw: rawToken, hashed: hashedToken } = newGuestToken();

				const guestSession = await tx.guestSession.create({
					data: {
						name: input.name,
						email,
						magicLinkId: link.id,
						projectId,
						sessionToken: hashedToken,
					},
				});

				// Add as a project participant.
				//
				// Intentionally NO rebalance-on-add here: rebalancing existing
				// expenses is organizer-driven and offered from the Share dialog.
				// The joiner is the actor, not an organizer, so folding themselves
				// into everyone else's past expenses would be a self-service change
				// to other people's balances. Don't "fix" this by triggering it.
				await joinProject(tx, {
					projectId,
					participantType: "guest",
					participantId: guestSession.id,
					role: link.roleGranted,
				}, null);

				// Increment useCount
				await tx.magicLink.update({
					where: { id: link.id },
					data: { useCount: { increment: 1 } },
				});

				return {
					kind: "created" as const,
					sessionToken: rawToken,
					guestSessionId: guestSession.id,
				};
			});

			if (result.kind === "resume") {
				const baseUrl =
					env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:1997";
				const resumeUrl = `${baseUrl}/projects/${projectId}?guestResume=${result.resumeToken}`;
				const html = notificationEmail({
					title: `Continue in ${link.project.name}`,
					body: `Someone asked to rejoin '${link.project.name}' on Retrospend with this email address. If it was you, use the button below to pick up where you left off. The link works once and expires in one hour. If it wasn't you, you can ignore this email.`,
					ctaUrl: resumeUrl,
					ctaLabel: "Continue",
				});
				await sendEmail(
					result.sendTo,
					`Retrospend: continue in ${link.project.name}`,
					html,
				);

				return {
					resumeEmailSent: true as const,
					projectId,
					projectName: link.project.name,
				};
			}

			return {
				resumeEmailSent: false as const,
				sessionToken: result.sessionToken,
				guestSessionId: result.guestSessionId,
				projectId,
				projectName: link.project.name,
				role: link.roleGranted,
			};
		}),

	/**
	 * Redeems a resume link mailed by `register` to a guest who already joined
	 * this project. Holding the link proves ownership of the email, so the
	 * guest's session gets a fresh token (signing out any other device, as
	 * before). The link is single-use and expires after an hour.
	 *
	 * If an organizer removed the guest in the meantime, membership is restored
	 * only while the invite link they rejoined through is still valid.
	 */
	resume: publicProcedure
		.input(z.object({ token: z.string().min(1).max(255) }))
		.mutation(async ({ ctx, input }) => {
			const clientIp = getClientIp(ctx.headers);
			if (!rateLimiter.check(`guestResume_${clientIp}`, 10, 60_000)) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "Rate limit exceeded",
				});
			}

			const invalid = () =>
				new TRPCError({
					code: "NOT_FOUND",
					message: "This link is invalid or has expired",
				});

			return await ctx.db.$transaction(async (tx) => {
				const stored = await tx.verificationToken.findUnique({
					where: { token: hashToken(input.token) },
				});
				if (!stored?.identifier.startsWith(GUEST_RESUME_PREFIX)) {
					throw invalid();
				}
				// Single use.
				await tx.verificationToken.delete({ where: { token: stored.token } });
				if (stored.expires < new Date()) throw invalid();

				const [guestSessionId, linkId] = stored.identifier
					.slice(GUEST_RESUME_PREFIX.length)
					.split(":");
				const session = guestSessionId
					? await tx.guestSession.findUnique({ where: { id: guestSessionId } })
					: null;
				if (!session) throw invalid();

				const { raw, hashed } = newGuestToken();
				await tx.guestSession.update({
					where: { id: session.id },
					data: { sessionToken: hashed, lastActiveAt: new Date() },
				});

				const membership = await tx.projectParticipant.findUnique({
					where: {
						projectId_participantType_participantId: {
							projectId: session.projectId,
							participantType: "guest",
							participantId: session.id,
						},
					},
				});
				if (!membership && linkId) {
					const link = await tx.magicLink.findUnique({ where: { id: linkId } });
					let linkOk = false;
					if (link && link.projectId === session.projectId) {
						try {
							validateLinkOrThrow(link, { allowUsedUp: true });
							linkOk = true;
						} catch {
							linkOk = false;
						}
					}
					if (linkOk && link) {
						await joinProject(tx, {
							projectId: session.projectId,
							participantType: "guest",
							participantId: session.id,
							role: link.roleGranted,
						}, null);
					}
				}

				return {
					sessionToken: raw,
					guestSessionId: session.id,
					projectId: session.projectId,
				};
			});
		}),

	/**
	 * A signed-in user joins a project through its invite link with their own
	 * account. This is the only way an invite link adds a registered account:
	 * the session proves who is joining, unlike the email typed into register.
	 *
	 * Uses the global db because RLS hides a project's links and roster from
	 * someone who isn't a member yet. Already a member: no change, and the link
	 * use isn't counted again.
	 */
	joinWithAccount: protectedProcedure
		.input(z.object({ linkId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const clientIp = getClientIp(ctx.headers);
			if (!rateLimiter.check(`guestJoinAccount_${clientIp}`, 10, 60_000)) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "Rate limit exceeded",
				});
			}

			return await globalDb.$transaction(async (tx) => {
				const link = await tx.magicLink.findUnique({
					where: { id: input.linkId },
				});
				if (!link) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "This invite link is no longer valid",
					});
				}

				const existing = await tx.projectParticipant.findUnique({
					where: {
						projectId_participantType_participantId: {
							projectId: link.projectId,
							participantType: "user",
							participantId: userId,
						},
					},
				});
				if (existing) {
					return { projectId: link.projectId, alreadyMember: true };
				}

				validateLinkOrThrow(link);

				await joinProject(tx, {
					projectId: link.projectId,
					participantType: "user",
					participantId: userId,
					role: link.roleGranted,
				}, userId);
				await tx.magicLink.update({
					where: { id: link.id },
					data: { useCount: { increment: 1 } },
				});

				return { projectId: link.projectId, alreadyMember: false };
			});
		}),

	/**
	 * Self-service data deletion for guests.
	 *
	 * Anonymizes all shared-expense records referencing this guest session,
	 * removes the participant record, and deletes the session - all atomically.
	 * Only callable by authenticated guest sessions (not full users).
	 */
	deleteMyData: guestOrProtectedProcedure
		.input(z.object({ confirmation: z.literal(true) }))
		.mutation(async ({ ctx }) => {
			if (ctx.participant.participantType !== 'guest') {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Only guest sessions can use this endpoint',
				});
			}

			const guestId = ctx.participant.participantId;

			await ctx.db.$transaction(async (tx) => {
				await anonymizeParticipantReferences(tx, "guest", guestId, DELETED_GUEST_SENTINEL);
				await tx.guestSession.delete({ where: { id: guestId } });
			});

			return { success: true };
		}),

});
