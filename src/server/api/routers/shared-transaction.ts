import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	assertGuestProjectScope,
	assertWritableParticipant,
	createTRPCRouter,
	guestOrProtectedProcedure,
} from "~/server/api/trpc";
import { getImageUrl } from "~/server/storage";
import { SharedTransactionService } from "~/server/services/shared-expenses/transaction.service";

const participantRefSchema = z.object({
	participantType: z.enum(["user", "guest", "shadow"]),
	participantId: z.string().min(1),
});

const splitParticipantSchema = participantRefSchema.extend({
	shareAmount: z.number().nonnegative().optional(),
	sharePercentage: z.number().min(0).max(100).optional(),
	shareUnits: z.number().int().positive().optional(),
});

const splitModeEnum = z.enum(["EQUAL", "EXACT", "PERCENTAGE", "SHARES"]);

export const sharedTransactionRouter = createTRPCRouter({
	create: guestOrProtectedProcedure
		.input(
			z.object({
				amount: z.number().positive("Amount must be positive"),
				currency: z.string().min(1).max(10),
				description: z.string().min(1).max(500),
				categoryId: z.string().cuid().optional(),
				date: z.date(),
				paidBy: participantRefSchema,
				splitWith: z
					.array(splitParticipantSchema)
					.min(1, "A shared expense must have at least 1 participant"),
				splitMode: splitModeEnum,
				projectId: z.string().cuid().optional(),
				notes: z.string().max(5000).optional(),
				receiptUrl: z.string().url().max(2048).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const actor = assertWritableParticipant(ctx.participant);
			if (input.projectId) {
				assertGuestProjectScope(ctx.participant, input.projectId);
			} else if (actor.participantType === "guest") {
				// Guests can only create transactions within their project scope
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Guests must specify a projectId",
				});
			}
			const service = new SharedTransactionService(ctx.db, actor);
			return await service.create(input);
		}),

	update: guestOrProtectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				amount: z.number().positive("Amount must be positive").optional(),
				currency: z.string().min(1).max(10).optional(),
				description: z.string().min(1).max(500).optional(),
				categoryId: z.string().cuid().nullish(),
				date: z.date().optional(),
				paidBy: participantRefSchema.optional(),
				splitWith: z
					.array(splitParticipantSchema)
					.min(2, "A shared expense must have at least 2 participants")
					.optional(),
				splitMode: splitModeEnum.optional(),
				projectId: z.string().cuid().nullish(),
				notes: z.string().max(5000).nullish(),
				receiptUrl: z.string().url().max(2048).nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const actor = assertWritableParticipant(ctx.participant);
			const service = new SharedTransactionService(ctx.db, actor);
			return await service.update(input);
		}),

	delete: guestOrProtectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const actor = assertWritableParticipant(ctx.participant);
			const service = new SharedTransactionService(ctx.db, actor);
			await service.delete(input.id);
			return { success: true };
		}),

	getById: guestOrProtectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			// viewerLink participants are not split participants and cannot view individual transactions
			if (ctx.participant.participantType === "viewerLink") {
				throw new TRPCError({ code: "FORBIDDEN", message: "Viewers cannot access individual transaction details" });
			}
			const { participantType, participantId } = ctx.participant;

			const tx = await ctx.db.sharedTransaction.findUnique({
				where: { id: input.id },
				include: {
					category: { select: { id: true, name: true, color: true } },
					project: { select: { id: true, name: true } },
					splitParticipants: {
						select: {
							participantType: true,
							participantId: true,
							shareAmount: true,
							sharePercentage: true,
							shareUnits: true,
							verificationStatus: true,
						},
					},
				},
			});

			if (!tx) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
			}

			const isParticipant = tx.splitParticipants.some(
				(sp) => sp.participantType === participantType && sp.participantId === participantId,
			);
			if (!isParticipant) {
				// Allow project participants to view any transaction in their project
				let isProjectMember = false;
				if (tx.projectId) {
					const pp = await ctx.db.projectParticipant.findFirst({
						where: {
							projectId: tx.projectId,
							participantType: participantType as "user" | "guest" | "shadow",
							participantId,
						},
						select: { id: true },
					});
					isProjectMember = !!pp;
				}
				if (!isProjectMember) {
					throw new TRPCError({ code: "FORBIDDEN", message: "Not a participant in this transaction" });
				}
			}

			// Compute permissions
			const isCreator =
				tx.createdByType === participantType && tx.createdById === participantId;
			let canEdit = false;
			let canDelete = false;

			if (!tx.isLocked) {
				if (tx.projectId) {
					const pp = await ctx.db.projectParticipant.findUnique({
						where: {
							projectId_participantType_participantId: {
								projectId: tx.projectId,
								participantType,
								participantId,
							},
						},
					});
					const role = pp?.role;
					if (
						role === "ORGANIZER" ||
						role === "EDITOR" ||
						(role === "CONTRIBUTOR" && isCreator)
					) {
						canEdit = true;
						canDelete = true;
					}
				} else {
					canEdit = isCreator;
					canDelete = isCreator;
				}
			}

			// Resolve participant names
			const allUserIds = [
				...new Set([
					...tx.splitParticipants
						.filter((sp) => sp.participantType === "user")
						.map((sp) => sp.participantId),
					...(tx.paidByType === "user" ? [tx.paidById] : []),
				]),
			];
			const shadowIds = [
				...new Set([
					...tx.splitParticipants
						.filter((sp) => sp.participantType === "shadow")
						.map((sp) => sp.participantId),
					...(tx.paidByType === "shadow" ? [tx.paidById] : []),
				]),
			];
			const guestIds = [
				...new Set([
					...tx.splitParticipants
						.filter((sp) => sp.participantType === "guest")
						.map((sp) => sp.participantId),
					...(tx.paidByType === "guest" ? [tx.paidById] : []),
				]),
			];

			const [users, shadows, guests] = await Promise.all([
				allUserIds.length > 0
					? ctx.db.user.findMany({
							where: { id: { in: allUserIds } },
							select: { id: true, name: true, image: true, avatarPath: true },
						})
					: [],
				shadowIds.length > 0
					? ctx.db.shadowProfile.findMany({
							where: { id: { in: shadowIds } },
							select: { id: true, name: true, email: true },
						})
					: [],
				guestIds.length > 0
					? ctx.db.guestSession.findMany({
							where: { id: { in: guestIds } },
							select: { id: true, name: true },
						})
					: [],
			]);

			const userMap = new Map(users.map((u) => [u.id, u]));
			const shadowMap = new Map(shadows.map((s) => [s.id, s]));
			const guestMap = new Map(guests.map((g) => [g.id, g]));

			const resolveName = (type: string, id: string): string => {
				if (id === "DELETED_USER") return "Deleted User";
				if (type === "user") return userMap.get(id)?.name ?? "Unknown";
				if (type === "shadow") return shadowMap.get(id)?.name ?? "Unknown";
				return guestMap.get(id)?.name ?? "Unknown";
			};

			const resolveAvatarUrl = (type: string, id: string): string | null => {
				if (type === "user") {
					const u = userMap.get(id);
					return getImageUrl(u?.avatarPath ?? null) ?? u?.image ?? null;
				}
				return null;
			};

			const hasVerifiedParticipants = tx.splitParticipants.some(
				(sp) =>
					// Only count other participants — the creator is auto-ACCEPTED on creation
					!(sp.participantType === participantType && sp.participantId === participantId) &&
					(sp.verificationStatus === "ACCEPTED" ||
					sp.verificationStatus === "AUTO_ACCEPTED"),
			);

			return {
				id: tx.id,
				description: tx.description,
				amount: Number(tx.amount),
				currency: tx.currency,
				date: tx.date,
				notes: tx.notes,
				splitMode: tx.splitMode,
				projectId: tx.projectId,
				projectName: tx.project?.name ?? null,
				isLocked: tx.isLocked,
				category: tx.category,
				paidBy: {
					participantType: tx.paidByType,
					participantId: tx.paidById,
					name: resolveName(tx.paidByType, tx.paidById),
					avatarUrl: resolveAvatarUrl(tx.paidByType, tx.paidById),
				},
				splitParticipants: tx.splitParticipants.map((sp) => ({
					participantType: sp.participantType,
					participantId: sp.participantId,
					name: resolveName(sp.participantType, sp.participantId),
					shareAmount: Number(sp.shareAmount),
					sharePercentage: sp.sharePercentage ? Number(sp.sharePercentage) : null,
					shareUnits: sp.shareUnits,
					verificationStatus: sp.verificationStatus,
				})),
				hasVerifiedParticipants,
				canEdit,
				canDelete,
			};
		}),

	canModify: guestOrProtectedProcedure
		.input(z.object({ transactionId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			if (ctx.participant.participantType === "viewerLink") {
				return { canEdit: false, canDelete: false, reason: "Viewers cannot edit or delete expenses" };
			}
			const { participantType, participantId } = ctx.participant;

			const transaction = await ctx.db.sharedTransaction.findUnique({
				where: { id: input.transactionId },
			});

			if (!transaction) {
				return { canEdit: false, canDelete: false, reason: "Transaction not found" };
			}

			if (transaction.isLocked) {
				return { canEdit: false, canDelete: false, reason: "Transaction is settled" };
			}

			const isCreator =
				transaction.createdByType === participantType &&
				transaction.createdById === participantId;

			if (transaction.projectId) {
				const projectParticipant = await ctx.db.projectParticipant.findUnique({
					where: {
						projectId_participantType_participantId: {
							projectId: transaction.projectId,
							participantType,
							participantId,
						},
					},
				});

				if (!projectParticipant) {
					return { canEdit: false, canDelete: false, reason: "Not a participant in this project" };
				}

				const role = projectParticipant.role;
				if (role === "ORGANIZER" || role === "EDITOR") {
					return { canEdit: true, canDelete: true };
				}
				if (role === "CONTRIBUTOR") {
					const can = isCreator;
					return {
						canEdit: can,
						canDelete: can,
						...(can ? {} : { reason: "You can only modify expenses you created" }),
					};
				}
				// VIEWER
				return { canEdit: false, canDelete: false, reason: "Viewers cannot edit or delete expenses" };
			}

			// Standalone transaction
			return {
				canEdit: isCreator,
				canDelete: isCreator,
				...(isCreator ? {} : { reason: "Only the creator can modify this expense" }),
			};
		}),
});
