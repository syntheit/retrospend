import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { env } from "~/env";
import { verifyUnsubscribeToken } from "~/lib/unsubscribe-token";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";
import { db as globalDb } from "~/server/db";
import type { NotificationType } from "~prisma";

// All NotificationType values with their default email preference
const ALL_TYPES: NotificationType[] = [
	"EXPENSE_SPLIT",
	"VERIFICATION_REQUEST",
	"EXPENSE_EDITED",
	"EXPENSE_DELETED",
	"SETTLEMENT_RECEIVED",
	"SETTLEMENT_CONFIRMED",
	"SETTLEMENT_REJECTED",
	"PERIOD_CLOSED",
	"PARTICIPANT_ADDED",
	"PAYMENT_REMINDER",
];

const EMAIL_ON_BY_DEFAULT = new Set<NotificationType>([
	"VERIFICATION_REQUEST",
	"PERIOD_CLOSED",
]);

export const notificationRouter = createTRPCRouter({
	/**
	 * Fetch notifications for the current user, sorted by recency.
	 * Supports cursor-based pagination.
	 */
	list: protectedProcedure
		.input(
			z.object({
				unreadOnly: z.boolean().default(false),
				limit: z.number().int().positive().max(50).default(20),
				cursor: z.string().optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const { unreadOnly, limit, cursor } = input;

			const items = await ctx.db.notification.findMany({
				where: {
					userId,
					...(unreadOnly ? { isRead: false } : {}),
				},
				orderBy: { createdAt: "desc" },
				...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
				take: limit + 1,
			});

			let nextCursor: string | undefined;
			if (items.length > limit) {
				const last = items.pop();
				nextCursor = last?.id;
			}

			return { items, nextCursor };
		}),

	/**
	 * Count unread notifications. Polled frequently: kept fast with indexed query.
	 */
	unreadCount: protectedProcedure.query(async ({ ctx }) => {
		const count = await ctx.db.notification.count({
			where: { userId: ctx.session.user.id, isRead: false },
		});
		return { count };
	}),

	/**
	 * Mark a single notification as read.
	 */
	markRead: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await ctx.db.notification.updateMany({
				where: { id: input.id, userId: ctx.session.user.id },
				data: { isRead: true },
			});
			return { success: true };
		}),

	/**
	 * Mark all notifications as read for the current user.
	 */
	markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
		await ctx.db.notification.updateMany({
			where: { userId: ctx.session.user.id, isRead: false },
			data: { isRead: true },
		});
		return { success: true };
	}),

	/**
	 * Get notification preferences for the current user.
	 * Creates default preferences if none exist yet.
	 */
	getPreferences: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.session.user.id;

		const existing = await ctx.db.notificationPreference.findMany({
			where: { userId },
		});

		const existingTypes = new Set(existing.map((p) => p.type));
		const missing = ALL_TYPES.filter((t) => !existingTypes.has(t));

		if (missing.length > 0) {
			await ctx.db.notificationPreference.createMany({
				data: missing.map((type) => ({
					userId,
					type,
					inApp: true,
					email: EMAIL_ON_BY_DEFAULT.has(type),
					digestMode: false,
				})),
				skipDuplicates: true,
			});
		}

		return ctx.db.notificationPreference.findMany({
			where: { userId },
			orderBy: { type: "asc" },
		});
	}),

	/**
	 * Upsert notification preferences for the current user.
	 */
	updatePreferences: protectedProcedure
		.input(
			z.object({
				preferences: z.array(
					z.object({
						type: z.enum([
							"EXPENSE_SPLIT",
							"VERIFICATION_REQUEST",
							"EXPENSE_EDITED",
							"EXPENSE_DELETED",
							"SETTLEMENT_RECEIVED",
							"SETTLEMENT_CONFIRMED",
							"SETTLEMENT_REJECTED",
							"PERIOD_CLOSED",
							"PARTICIPANT_ADDED",
							"PAYMENT_REMINDER",
						]),
						inApp: z.boolean(),
						email: z.boolean(),
						digestMode: z.boolean(),
					}),
				),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			await Promise.all(
				input.preferences.map((pref) =>
					ctx.db.notificationPreference.upsert({
						where: { userId_type: { userId, type: pref.type } },
						create: { userId, ...pref },
						update: {
							inApp: pref.inApp,
							email: pref.email,
							digestMode: pref.digestMode,
						},
					}),
				),
			);

			return { success: true };
		}),

	/**
	 * Public one-click unsubscribe endpoint.
	 * Verifies the HMAC-signed token then sets email=false for the given
	 * notification type. No authentication required - the signed token IS the auth.
	 */
	unsubscribe: publicProcedure
		.input(
			z.object({
				token: z.string().min(1),
				userId: z.string().min(1),
				type: z.enum([
					"EXPENSE_SPLIT",
					"VERIFICATION_REQUEST",
					"EXPENSE_EDITED",
					"EXPENSE_DELETED",
					"SETTLEMENT_RECEIVED",
					"SETTLEMENT_CONFIRMED",
					"SETTLEMENT_REJECTED",
					"PERIOD_CLOSED",
					"PARTICIPANT_ADDED",
					"PAYMENT_REMINDER",
				]),
			}),
		)
		.mutation(async ({ input }) => {
			const secret = env.UNSUBSCRIBE_SECRET;
			if (!secret) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Unsubscribe links are not configured on this server",
				});
			}

			const valid = verifyUnsubscribeToken(input.token, input.userId, input.type, secret);
			if (!valid) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "Invalid or tampered unsubscribe link",
				});
			}

			// Guard: if the user was deleted after the link was sent, silently succeed
			// rather than crashing with a FK violation on the upsert.
			const userExists = await globalDb.user.findUnique({
				where: { id: input.userId },
				select: { id: true },
			});
			if (!userExists) {
				return { success: true };
			}

			await globalDb.notificationPreference.upsert({
				where: { userId_type: { userId: input.userId, type: input.type } },
				create: {
					userId: input.userId,
					type: input.type,
					inApp: true,
					email: false,
					digestMode: false,
				},
				update: { email: false },
			});

			return { success: true };
		}),

	/**
	 * Public: unsubscribe from all notification email types at once.
	 */
	unsubscribeAll: publicProcedure
		.input(
			z.object({
				token: z.string().min(1),
				userId: z.string().min(1),
			}),
		)
		.mutation(async ({ input }) => {
			const secret = env.UNSUBSCRIBE_SECRET;
			if (!secret) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Unsubscribe links are not configured on this server",
				});
			}

			const valid = verifyUnsubscribeToken(input.token, input.userId, "ALL", secret);
			if (!valid) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "Invalid or tampered unsubscribe link",
				});
			}

			await Promise.all(
				ALL_TYPES.map((type) =>
					globalDb.notificationPreference.upsert({
						where: { userId_type: { userId: input.userId, type } },
						create: {
							userId: input.userId,
							type,
							inApp: true,
							email: false,
							digestMode: false,
						},
						update: { email: false },
					}),
				),
			);

			return { success: true };
		}),
});
