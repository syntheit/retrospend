import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	createTRPCRouter,
	guestOrProtectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import { InMemoryRateLimiter, getClientIp } from "~/server/lib/rate-limiter";
import {
	DELETED_GUEST_SENTINEL,
} from "~/server/services/user-deletion.service";

const rateLimiter = new InMemoryRateLimiter();

/**
 * Validates an invite link and returns safe project info.
 * Returns NOT_FOUND for all invalid states (expired / revoked / max uses) to
 * prevent enumeration attacks.
 */
function validateLinkOrThrow(link: {
	isActive: boolean;
	expiresAt: Date | null;
	maxUses: number | null;
	useCount: number;
}): void {
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
	if (link.maxUses !== null && link.useCount >= link.maxUses) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "This invite link is no longer valid",
		});
	}
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
							type: true,
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
				projectType: link.project.type,
				projectImagePath: link.project.imagePath,
				participantCount: link.project._count.participants,
				roleGranted: link.roleGranted,
			};
		}),

	/**
	 * Registers a guest user via a magic link.
	 *
	 * - If the email already has a GuestSession for this project, returns the
	 *   existing session (updates lastActiveAt).
	 * - If the email belongs to an existing User, adds them as a participant
	 *   directly and returns { existingUser: true } so the frontend can redirect
	 *   to login.
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
				email: z.string().email().max(255),
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

			// Check if email belongs to an existing Retrospend user
			const existingUser = await ctx.db.user.findUnique({
				where: { email },
				select: { id: true },
			});

			if (existingUser) {
				// Add as a full participant (skip guest session)
				await ctx.db.projectParticipant.upsert({
					where: {
						projectId_participantType_participantId: {
							projectId,
							participantType: "user",
							participantId: existingUser.id,
						},
					},
					create: {
						projectId,
						participantType: "user",
						participantId: existingUser.id,
						role: link.roleGranted,
					},
					update: {}, // already a participant: no change needed
				});

				await ctx.db.magicLink.update({
					where: { id: link.id },
					data: { useCount: { increment: 1 } },
				});

				return {
					existingUser: true as const,
					projectId,
					projectName: link.project.name,
				};
			}

			// Wrap guest session creation in a transaction to prevent duplicates
			// from concurrent registrations with the same email + project.
			return await ctx.db.$transaction(async (tx) => {
				// Re-check for existing session inside the transaction
				const existingSession = await tx.guestSession.findFirst({
					where: { email, projectId },
				});

				if (existingSession) {
					// Generate a new token for the client: we can't recover the original
					// unhashed token. Issue a fresh one and update the hash in the DB.
					const newToken = randomBytes(32).toString("hex");
					const newHashedToken = createHash("sha256")
						.update(newToken)
						.digest("hex");

					await tx.guestSession.update({
						where: { id: existingSession.id },
						data: {
							sessionToken: newHashedToken,
							lastActiveAt: new Date(),
							name: input.name, // allow name update on re-registration
						},
					});

					// Ensure participant record exists (may have been removed by an
					// organizer or via deleteMyData between registrations).
					await tx.projectParticipant.upsert({
						where: {
							projectId_participantType_participantId: {
								projectId,
								participantType: "guest",
								participantId: existingSession.id,
							},
						},
						create: {
							projectId,
							participantType: "guest",
							participantId: existingSession.id,
							role: link.roleGranted,
						},
						update: {},
					});

					return {
						existingUser: false as const,
						sessionToken: newToken,
						guestSessionId: existingSession.id,
						projectId,
						projectName: link.project.name,
						role: link.roleGranted,
					};
				}

				// Create a new guest session
				const rawToken = randomBytes(32).toString("hex");
				const hashedToken = createHash("sha256").update(rawToken).digest("hex");

				const guestSession = await tx.guestSession.create({
					data: {
						name: input.name,
						email,
						magicLinkId: link.id,
						projectId,
						sessionToken: hashedToken,
					},
				});

				// Add as a project participant
				await tx.projectParticipant.create({
					data: {
						projectId,
						participantType: "guest",
						participantId: guestSession.id,
						role: link.roleGranted,
					},
				});

				// Increment useCount
				await tx.magicLink.update({
					where: { id: link.id },
					data: { useCount: { increment: 1 } },
				});

				return {
					existingUser: false as const,
					sessionToken: rawToken,
					guestSessionId: guestSession.id,
					projectId,
					projectName: link.project.name,
					role: link.roleGranted,
				};
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
				// Anonymize SplitParticipant records
				//
				// Guard against @@unique([transactionId, participantType, participantId]):
				// if DELETED_GUEST already exists in a transaction (prior guest deletion),
				// merge shareAmount into that row, delete the conflicting row, then update
				// remaining rows normally.
				await tx.$executeRaw`
					UPDATE split_participant AS target
					SET    "shareAmount" = target."shareAmount" + source."shareAmount"
					FROM   split_participant AS source
					WHERE  source."participantType" = 'guest'
					  AND  source."participantId"   = ${guestId}
					  AND  target."transactionId"   = source."transactionId"
					  AND  target."participantType" = 'guest'
					  AND  target."participantId"   = ${DELETED_GUEST_SENTINEL}
				`;
				await tx.$executeRaw`
					DELETE FROM split_participant
					WHERE  "participantType" = 'guest'
					  AND  "participantId"   = ${guestId}
					  AND  "transactionId" IN (
						SELECT "transactionId"
						FROM   split_participant
						WHERE  "participantType" = 'guest'
						  AND  "participantId"   = ${DELETED_GUEST_SENTINEL}
					  )
				`;
				await tx.splitParticipant.updateMany({
					where: { participantType: 'guest', participantId: guestId },
					data: { participantId: DELETED_GUEST_SENTINEL },
				});

				// Anonymize SharedTransaction paidBy
				await tx.sharedTransaction.updateMany({
					where: { paidByType: 'guest', paidById: guestId },
					data: { paidById: DELETED_GUEST_SENTINEL },
				});

				// Anonymize SharedTransaction createdBy
				await tx.sharedTransaction.updateMany({
					where: { createdByType: 'guest', createdById: guestId },
					data: { createdById: DELETED_GUEST_SENTINEL },
				});

				// Anonymize Settlement fromParticipant
				await tx.settlement.updateMany({
					where: { fromParticipantType: 'guest', fromParticipantId: guestId },
					data: { fromParticipantId: DELETED_GUEST_SENTINEL },
				});

				// Anonymize Settlement toParticipant
				await tx.settlement.updateMany({
					where: { toParticipantType: 'guest', toParticipantId: guestId },
					data: { toParticipantId: DELETED_GUEST_SENTINEL },
				});

				// Anonymize AuditLogEntry actor
				await tx.auditLogEntry.updateMany({
					where: { actorType: 'guest', actorId: guestId },
					data: { actorId: DELETED_GUEST_SENTINEL },
				});

				// Remove ProjectParticipant record
				await tx.projectParticipant.deleteMany({
					where: { participantType: 'guest', participantId: guestId },
				});

				// Delete the GuestSession itself
				await tx.guestSession.delete({ where: { id: guestId } });
			});

			return { success: true };
		}),

});
