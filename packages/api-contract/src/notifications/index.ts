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
	"RECURRING_DUE",
] as const;

/**
 * The types that make an inbox notification or an email. RECURRING_DUE is
 * only a push, so only its `push` switch means anything.
 */
export const INBOX_NOTIFICATION_TYPES = NOTIFICATION_TYPES.filter(
	(type) => type !== "RECURRING_DUE",
);

/** The types that have a push; the others ignore the `push` switch. */
export const PUSH_NOTIFICATION_TYPES: readonly (typeof NOTIFICATION_TYPES)[number][] =
	[
		"EXPENSE_SPLIT",
		"VERIFICATION_REQUEST",
		"EXPENSE_EDITED",
		"SETTLEMENT_RECEIVED",
		"SETTLEMENT_CONFIRMED",
		"SETTLEMENT_REJECTED",
		"PAYMENT_REMINDER",
		"RECURRING_DUE",
	];

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
		/**
		 * A push to the caller's phones and browsers, independent of `inApp`.
		 * Only the types that have a push (not EXPENSE_DELETED, PERIOD_CLOSED or
		 * PARTICIPANT_ADDED) act on it.
		 */
		push: z.boolean(),
		email: z.boolean(),
		/** Email arrives in a digest instead of one message each. */
		digestMode: z.boolean(),
	})
	.meta({ id: "NotificationPreference" });

/** What a write takes: `push` may be left out, which keeps its current value. */
export const notificationPreferenceInputSchema = notificationPreferenceSchema
	.extend({ push: z.boolean().optional() })
	.meta({ id: "NotificationPreferenceInput" });

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
			description:
				"Types left out keep their current setting, and so does `push` when it is left out of a type (a new row then starts `push` as `inApp`). `inApp`, `email` and `digestMode` do nothing for RECURRING_DUE, which is only a push.",
		})
		.meta({
			scope: "write:settings",
			event: "notification_preferences.updated",
		})
		.input(
			z.object({
				preferences: z.array(notificationPreferenceInputSchema).min(1).max(50),
			}),
		)
		.output(notificationPreferencesSchema),
};
