import { v1 } from "../common/meta";
import { cursorQuerySchema, pageOf } from "../common/pagination";
import { idParamsSchema, okSchema } from "../core";
import {
	inviteCodeListQuerySchema,
	inviteCodePageSchema,
	inviteCodeSchema,
} from "../invite-codes";
import {
	adminAiSettingsSchema,
	adminFeedbackPageSchema,
	adminSettingsSchema,
	adminStatsSchema,
	adminUserParamsSchema,
	adminUserSchema,
	aiUsageQuerySchema,
	aiUsageSchema,
	backupStartedSchema,
	backupStatusSchema,
	eventLogEntrySchema,
	eventLogQuerySchema,
	feedbackListQuerySchema,
	feedbackParamsSchema,
	setEmailVerifiedSchema,
	setFeedbackNoteSchema,
	setFeedbackStatusSchema,
	setUserAiAccessSchema,
	updateAdminAiSettingsSchema,
	updateAdminSettingsSchema,
} from "./schemas";

export * from "./schemas";

const TAG = ["Admin"];

/**
 * Every route needs the `admin` scope and an admin account. A token holds
 * `admin` only if it was issued to an admin, and loses it the day the role
 * is removed. Handing out passwords or reset links stays in the web app.
 */
export const adminContract = {
	stats: v1
		.route({
			method: "GET",
			path: "/admin/stats",
			operationId: "getAdminStats",
			tags: TAG,
			summary: "User count, database and storage size, uptime",
		})
		.meta({ scope: "admin" })
		.output(adminStatsSchema),
	listUsers: v1
		.route({
			method: "GET",
			path: "/admin/users",
			operationId: "listAdminUsers",
			tags: TAG,
			summary: "Accounts, newest first, with counts of what each holds",
			description:
				"Counts and flags only: no titles, notes or amounts of any user.",
		})
		.meta({ scope: "admin" })
		.input(cursorQuerySchema)
		.output(pageOf(adminUserSchema)),
	disableUser: v1
		.route({
			method: "POST",
			path: "/admin/users/{id}/disable",
			operationId: "disableUser",
			tags: TAG,
			summary: "Disable an account and sign it out everywhere",
			description: "You cannot disable your own account.",
		})
		.meta({ scope: "admin", event: "admin_user.disabled" })
		.input(adminUserParamsSchema)
		.output(okSchema),
	enableUser: v1
		.route({
			method: "POST",
			path: "/admin/users/{id}/enable",
			operationId: "enableUser",
			tags: TAG,
			summary: "Enable a disabled account",
		})
		.meta({ scope: "admin", event: "admin_user.enabled" })
		.input(adminUserParamsSchema)
		.output(okSchema),
	setEmailVerified: v1
		.route({
			method: "PUT",
			path: "/admin/users/{id}/email-verified",
			operationId: "setUserEmailVerified",
			tags: TAG,
			summary: "Mark an account's email verified or not",
		})
		.meta({ scope: "admin", event: "admin_user.email_verified_set" })
		.input(setEmailVerifiedSchema)
		.output(okSchema),
	setAiAccess: v1
		.route({
			method: "PUT",
			path: "/admin/users/{id}/ai-access",
			operationId: "setUserAiAccess",
			tags: TAG,
			summary: "Allow, block or reset an account's external AI access",
		})
		.meta({ scope: "admin", event: "admin_user.ai_access_set" })
		.input(setUserAiAccessSchema)
		.output(okSchema),
	removeAvatar: v1
		.route({
			method: "DELETE",
			path: "/admin/users/{id}/avatar",
			operationId: "removeUserAvatar",
			tags: TAG,
			summary: "Remove an account's uploaded picture",
		})
		.meta({ scope: "admin", event: "admin_user.avatar_removed" })
		.input(adminUserParamsSchema)
		.output(okSchema),
	deleteUser: v1
		.route({
			method: "DELETE",
			path: "/admin/users/{id}",
			operationId: "deleteUser",
			tags: TAG,
			summary: "Delete an account and anonymize what others share with it",
			description: "You cannot delete your own account.",
		})
		.meta({ scope: "admin", event: "admin_user.deleted" })
		.input(adminUserParamsSchema)
		.output(okSchema),
	getSettings: v1
		.route({
			method: "GET",
			path: "/admin/settings",
			operationId: "getAdminSettings",
			tags: TAG,
			summary: "Server settings: sign-up, email, audit privacy, import limits",
		})
		.meta({ scope: "admin" })
		.output(adminSettingsSchema),
	updateSettings: v1
		.route({
			method: "PATCH",
			path: "/admin/settings",
			operationId: "updateAdminSettings",
			tags: TAG,
			summary: "Change server settings",
		})
		.meta({ scope: "admin", event: "admin_settings.updated" })
		.input(updateAdminSettingsSchema)
		.output(adminSettingsSchema),
	getAiSettings: v1
		.route({
			method: "GET",
			path: "/admin/ai-settings",
			operationId: "getAdminAiSettings",
			tags: TAG,
			summary: "AI mode, access mode and token quotas",
		})
		.meta({ scope: "admin" })
		.output(adminAiSettingsSchema),
	updateAiSettings: v1
		.route({
			method: "PATCH",
			path: "/admin/ai-settings",
			operationId: "updateAdminAiSettings",
			tags: TAG,
			summary: "Change AI mode, access mode and token quotas",
		})
		.meta({ scope: "admin", event: "admin_ai_settings.updated" })
		.input(updateAdminAiSettingsSchema)
		.output(adminAiSettingsSchema),
	aiUsage: v1
		.route({
			method: "GET",
			path: "/admin/ai-usage",
			operationId: "getAdminAiUsage",
			tags: TAG,
			summary: "Tokens each account used in a month",
		})
		.meta({ scope: "admin" })
		.input(aiUsageQuerySchema)
		.output(aiUsageSchema),
	eventLogs: v1
		.route({
			method: "GET",
			path: "/admin/event-logs",
			operationId: "listEventLogs",
			tags: TAG,
			summary: "Sign-ins, account changes and other security events, newest first",
		})
		.meta({ scope: "admin" })
		.input(eventLogQuerySchema)
		.output(pageOf(eventLogEntrySchema)),
	getBackups: v1
		.route({
			method: "GET",
			path: "/admin/backups",
			operationId: "getBackupStatus",
			tags: TAG,
			summary: "Database backup status from the sidecar",
			description: "`available: false` when the sidecar cannot be reached.",
		})
		.meta({ scope: "admin" })
		.output(backupStatusSchema),
	startBackup: v1
		.route({
			method: "POST",
			path: "/admin/backups",
			operationId: "startBackup",
			tags: TAG,
			summary: "Start a database backup now",
			description: "Answers 202 once the sidecar accepted it.",
			successStatus: 202,
		})
		.meta({ scope: "admin", event: "admin_backup.started" })
		.output(backupStartedSchema),
	listInviteCodes: v1
		.route({
			method: "GET",
			path: "/admin/invite-codes",
			operationId: "listAdminInviteCodes",
			tags: TAG,
			summary: "Every invite code, newest first",
		})
		.meta({ scope: "admin" })
		.input(inviteCodeListQuerySchema)
		.output(inviteCodePageSchema),
	createInviteCode: v1
		.route({
			method: "POST",
			path: "/admin/invite-codes",
			operationId: "createAdminInviteCode",
			tags: TAG,
			summary: "Create an invite code",
			successStatus: 201,
		})
		.meta({ scope: "admin", event: "invite_code.created" })
		.output(inviteCodeSchema),
	deleteInviteCode: v1
		.route({
			method: "DELETE",
			path: "/admin/invite-codes/{id}",
			operationId: "deleteAdminInviteCode",
			tags: TAG,
			summary: "Delete any invite code",
		})
		.meta({ scope: "admin", event: "invite_code.deleted" })
		.input(idParamsSchema)
		.output(okSchema),
	listFeedback: v1
		.route({
			method: "GET",
			path: "/admin/feedback",
			operationId: "listFeedback",
			tags: TAG,
			summary: "Feedback users sent, newest first, with counts by status",
		})
		.meta({ scope: "admin" })
		.input(feedbackListQuerySchema)
		.output(adminFeedbackPageSchema),
	setFeedbackStatus: v1
		.route({
			method: "PUT",
			path: "/admin/feedback/{id}/status",
			operationId: "setFeedbackStatus",
			tags: TAG,
			summary: "Mark feedback unread, read or archived",
		})
		.meta({ scope: "admin", event: "feedback.status_set" })
		.input(setFeedbackStatusSchema)
		.output(okSchema),
	setFeedbackNote: v1
		.route({
			method: "PUT",
			path: "/admin/feedback/{id}/note",
			operationId: "setFeedbackNote",
			tags: TAG,
			summary: "Write or clear the admin note on feedback",
		})
		.meta({ scope: "admin", event: "feedback.note_set" })
		.input(setFeedbackNoteSchema)
		.output(okSchema),
	deleteFeedback: v1
		.route({
			method: "DELETE",
			path: "/admin/feedback/{id}",
			operationId: "deleteFeedback",
			tags: TAG,
			summary: "Delete feedback",
		})
		.meta({ scope: "admin", event: "feedback.deleted" })
		.input(feedbackParamsSchema)
		.output(okSchema),
};
