import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { env } from "~/env";
import { verifyUnsubscribeToken } from "~/lib/unsubscribe-token";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";
import { db as globalDb } from "~/server/db";
import {
	countUnreadNotifications,
	getNotificationPreferences,
	listNotifications,
	markAllNotificationsRead,
	markNotificationRead,
	NOTIFICATION_TYPES,
	updateNotificationPreferences,
} from "~/server/services/notifications";
import type { NotificationType } from "~prisma";

const notificationTypeSchema = z.enum(
	NOTIFICATION_TYPES as [NotificationType, ...NotificationType[]],
);

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
			const items = await listNotifications(ctx.db, ctx.session.user.id, {
				unreadOnly: input.unreadOnly,
				take: input.limit + 1,
				afterId: input.cursor,
			});
			const nextCursor =
				items.length > input.limit ? items[input.limit - 1]?.id : undefined;
			return { items: items.slice(0, input.limit), nextCursor };
		}),

	/**
	 * Count unread notifications. Polled frequently: kept fast with indexed query.
	 */
	unreadCount: protectedProcedure.query(async ({ ctx }) => ({
		count: await countUnreadNotifications(ctx.db, ctx.session.user.id),
	})),

	markRead: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await markNotificationRead(ctx.db, ctx.session.user.id, input.id);
			return { success: true };
		}),

	markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
		await markAllNotificationsRead(ctx.db, ctx.session.user.id);
		return { success: true };
	}),

	/** Preferences per type, creating the defaults the first time. */
	getPreferences: protectedProcedure.query(({ ctx }) =>
		getNotificationPreferences(ctx.db, ctx.session.user.id),
	),

	updatePreferences: protectedProcedure
		.input(
			z.object({
				preferences: z.array(
					z.object({
						type: notificationTypeSchema,
						inApp: z.boolean(),
						email: z.boolean(),
						digestMode: z.boolean(),
					}),
				),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await updateNotificationPreferences(
				ctx.db,
				ctx.session.user.id,
				input.preferences,
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
				NOTIFICATION_TYPES.map((type) =>
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
