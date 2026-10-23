import * as z from "zod";
import { v1 } from "../common/meta";
import { cursorQuerySchema, pageOf } from "../common/pagination";
import { idParamsSchema, idSchema, okSchema, timestampSchema } from "../core";

/** Mirrors the NotificationType enum in prisma/schema.prisma. */
export const NOTIFICATION_TYPES = [
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
] as const;

export const notificationTypeSchema = z
	.enum(NOTIFICATION_TYPES)
	.meta({ id: "NotificationType" });

export const notificationSchema = z
	.object({
		id: idSchema,
		type: notificationTypeSchema,
		title: z.string(),
		body: z.string(),
		/** Ids the app links to (transactionId, projectId...), by type. */
		data: z.record(z.string(), z.unknown()).nullable(),
		isRead: z.boolean(),
		createdAt: timestampSchema,
	})
	.meta({ id: "Notification" });

export const notificationPreferenceSchema = z
	.object({
		type: notificationTypeSchema,
		inApp: z.boolean(),
		email: z.boolean(),
		/** Email arrives in a digest instead of one message each. */
		digestMode: z.boolean(),
	})
	.meta({ id: "NotificationPreference" });

export const notificationPreferencesSchema = z
	.object({ preferences: z.array(notificationPreferenceSchema) })
	.meta({ id: "NotificationPreferences" });

const TAG = ["Notifications"];

export const notificationsContract = {
	list: v1
		.route({
			method: "GET",
			path: "/notifications",
			operationId: "listNotifications",
			tags: TAG,
			summary: "The caller's notifications, newest first",
		})
		.meta({ scope: "read" })
		.input(
			cursorQuerySchema.extend({
				unreadOnly: z.enum(["true", "false"]).optional(),
			}),
		)
		.output(pageOf(notificationSchema)),
	unreadCount: v1
		.route({
			method: "GET",
			path: "/notifications/unread-count",
			operationId: "getUnreadNotificationCount",
			tags: TAG,
			summary: "How many notifications are unread",
		})
		.meta({ scope: "read" })
		.output(z.object({ count: z.int().min(0) })),
	markRead: v1
		.route({
			method: "POST",
			path: "/notifications/{id}/read",
			operationId: "markNotificationRead",
			tags: TAG,
			summary: "Mark one notification read",
		})
		.meta({ scope: "write:settings", event: "notification.marked_read" })
		.input(idParamsSchema)
		.output(okSchema),
	markAllRead: v1
		.route({
			method: "POST",
			path: "/notifications/read-all",
			operationId: "markAllNotificationsRead",
			tags: TAG,
			summary: "Mark every notification read",
		})
		.meta({ scope: "write:settings", event: "notification.all_marked_read" })
		.output(z.object({ count: z.int().min(0) })),
	getPreferences: v1
		.route({
			method: "GET",
			path: "/notifications/preferences",
			operationId: "getNotificationPreferences",
			tags: TAG,
			summary: "How each notification type reaches the caller",
		})
		.meta({ scope: "read" })
		.output(notificationPreferencesSchema),
	updatePreferences: v1
		.route({
			method: "PUT",
			path: "/notifications/preferences",
			operationId: "updateNotificationPreferences",
			tags: TAG,
			summary: "Change how notification types reach the caller",
			description: "Types left out keep their current setting.",
		})
		.meta({
			scope: "write:settings",
			event: "notification_preferences.updated",
		})
		.input(
			z.object({
				preferences: z.array(notificationPreferenceSchema).min(1).max(50),
			}),
		)
		.output(notificationPreferencesSchema),
};
