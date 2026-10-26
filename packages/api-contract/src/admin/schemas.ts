import * as z from "zod";
import { userText } from "../common/user-text";
import { idSchema, timestampSchema } from "../core";
import { daySchema } from "../ledger";

/**
 * Admin routes need the `admin` scope and the admin role. They answer with
 * accounts, settings and logs, never with another user's expense titles or
 * notes: users carry counts, event logs carry ids and account names.
 */

export const adminStatsSchema = z
	.object({
		userCount: z.int().min(0),
		databaseSizeBytes: z.int().min(0),
		storageSizeBytes: z.int().min(0),
		uptimeSeconds: z.int().min(0),
		/** The import queue across all users: files being read and waiting. */
		importQueue: z.object({
			maxConcurrent: z.int().min(1),
			currentProcessing: z.int().min(0),
			availableSlots: z.int(),
			totalQueued: z.int().min(0),
			totalReadyForReview: z.int().min(0),
			totalReviewing: z.int().min(0),
		}),
	})
	.meta({ id: "AdminStats" });

export const adminUserSchema = z
	.object({
		id: idSchema,
		username: z.string().nullable(),
		email: z.string(),
		emailVerified: z.boolean(),
		twoFactorEnabled: z.boolean(),
		role: z.enum(["USER", "ADMIN"]),
		isActive: z.boolean(),
		createdAt: timestampSchema,
		expenseCount: z.int().min(0),
		inviteCodesCount: z.int().min(0),
		lastExpenseDate: daySchema.nullable(),
		hasBudget: z.boolean(),
		hasRecurring: z.boolean(),
		hasWealth: z.boolean(),
		/** null follows the server default. */
		externalAiAllowed: z.boolean().nullable(),
	})
	.meta({ id: "AdminUser" });

export const adminUserParamsSchema = z.object({ id: idSchema });

export const setEmailVerifiedSchema = adminUserParamsSchema.extend({
	verified: z.boolean(),
});

export const setUserAiAccessSchema = adminUserParamsSchema.extend({
	allowed: z.boolean().nullable().meta({
		description: "true allows, false blocks, null follows the server default.",
	}),
});

export const AUDIT_PRIVACY_MODES = ["minimal", "anonymized", "full"] as const;

export const adminSettingsSchema = z
	.object({
		inviteOnlyEnabled: z.boolean(),
		allowAllUsersToGenerateInvites: z.boolean(),
		enableEmail: z.boolean(),
		auditPrivacyMode: z.enum(AUDIT_PRIVACY_MODES),
		maxConcurrentImportJobs: z.int().min(1).max(50),
		enableFeedback: z.boolean(),
		webhooksAllowPrivateTargets: z.boolean().meta({
			description:
				"Let webhooks send to addresses on a private network (localhost, 10.x, 192.168.x). Off by default; turn it on only for a self-hosted server whose receivers sit on the same network.",
		}),
	})
	.meta({ id: "AdminSettings" });

export type AdminSettingsDto = z.infer<typeof adminSettingsSchema>;

export const updateAdminSettingsSchema = adminSettingsSchema
	.partial()
	.meta({ id: "UpdateAdminSettings" });

export const adminAiSettingsSchema = z
	.object({
		defaultAiMode: z.enum(["LOCAL", "EXTERNAL"]),
		externalAiAccessMode: z.enum(["WHITELIST", "BLACKLIST"]),
		monthlyAiTokenQuota: z.int().min(0),
		monthlyLocalAiTokenQuota: z.int().min(0),
		monthlyExternalAiTokenQuota: z.int().min(0),
		/** Read only: whether an external provider key is set on the server. */
		openRouterConfigured: z.boolean(),
	})
	.meta({ id: "AdminAiSettings" });

export type AdminAiSettingsDto = z.infer<typeof adminAiSettingsSchema>;

export const updateAdminAiSettingsSchema = adminAiSettingsSchema
	.omit({ openRouterConfigured: true })
	.partial()
	.meta({ id: "UpdateAdminAiSettings" });

export const aiUsageQuerySchema = z.object({
	yearMonth: z
		.string()
		.regex(/^\d{4}-\d{2}$/)
		.optional(),
});

export const aiUsageSchema = z
	.object({
		quota: z.int(),
		localQuota: z.int(),
		externalQuota: z.int(),
		usages: z.array(
			z.object({
				userId: idSchema,
				username: z.string().nullable(),
				tokensUsed: z.int(),
				localTokensUsed: z.int(),
				externalTokensUsed: z.int(),
				yearMonth: z.string(),
			}),
		),
	})
	.meta({ id: "AdminAiUsage" });

export const EVENT_LOG_TYPES = [
	"FAILED_LOGIN",
	"SUCCESSFUL_LOGIN",
	"PASSWORD_RESET",
	"PASSWORD_CHANGED",
	"ACCOUNT_CREATED",
	"ACCOUNT_DELETED",
	"ACCOUNT_ENABLED",
	"ACCOUNT_DISABLED",
	"INVITE_USED",
	"INVITE_CREATED",
	"EMAIL_VERIFIED",
	"TWO_FACTOR_ENABLED",
	"TWO_FACTOR_DISABLED",
	"SETTINGS_UPDATED",
	"USER_UPDATED",
	"USERNAME_CHANGED",
	"EXPENSE_IMPORT",
	"ADMIN_RESET_LINK_GENERATED",
	"ADMIN_AI_ACCESS_CHANGED",
	"EMAIL_CHANGE_REQUESTED",
	"EMAIL_CHANGE_CONFIRMED",
	"EMAIL_CHANGE_REVERTED",
	"GUEST_UPGRADED",
	"ADMIN_DELETE_SHADOW_PROFILE",
	"ADMIN_DELETE_GUEST_SESSION",
] as const;

export const eventLogQuerySchema = z.object({
	cursor: z.string().min(1).max(512).optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	eventType: z.enum(EVENT_LOG_TYPES).optional(),
});

export const eventLogEntrySchema = z
	.object({
		id: idSchema,
		timestamp: timestampSchema,
		eventType: z.enum(EVENT_LOG_TYPES),
		user: z
			.object({
				id: idSchema,
				username: z.string().nullable(),
				email: z.string(),
			})
			.nullable(),
		/** Stored per the server's audit privacy mode; null in minimal mode. */
		ipAddress: z.string().nullable(),
		userAgent: z.string().nullable(),
		/** Ids, flags and account names. Any title, note or description key is dropped. */
		metadata: z.record(z.string(), z.unknown()).nullable(),
	})
	.meta({ id: "EventLogEntry" });

/** What the sidecar reports; every field but `available` is only there when it is. */
const backupResultSchema = z.object({
	timestamp: z.string(),
	filename: z.string(),
	sizeBytes: z.number(),
	durationMs: z.number(),
	success: z.boolean(),
	error: z.string().optional(),
});

export const backupStatusSchema = z
	.object({
		available: z.boolean(),
		running: z.boolean().optional(),
		lastBackup: backupResultSchema.optional(),
		nextScheduled: z.string().optional(),
		retentionDays: z.number().optional(),
		totalBackups: z.number().optional(),
		totalSize: z.number().optional(),
		history: z.array(backupResultSchema).optional(),
	})
	.meta({ id: "BackupStatus" });

export const backupStartedSchema = z
	.object({ status: z.string(), message: z.string() })
	.meta({ id: "BackupStarted" });

export const FEEDBACK_STATUSES = ["unread", "read", "archived"] as const;

export const feedbackStatusSchema = z
	.enum(FEEDBACK_STATUSES)
	.meta({ id: "FeedbackStatus" });

export const feedbackListQuerySchema = z.object({
	status: feedbackStatusSchema.optional(),
	cursor: z.string().min(1).max(512).optional(),
	limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const adminFeedbackSchema = z
	.object({
		id: idSchema,
		/** Written for the admins by the user, so it is returned to them. */
		message: z.string(),
		status: feedbackStatusSchema,
		adminNote: z.string().nullable(),
		pageUrl: z.string(),
		userAgent: z.string().nullable(),
		viewportSize: z.string().nullable(),
		appVersion: z.string().nullable(),
		createdAt: timestampSchema,
		user: z.object({
			id: idSchema,
			name: z.string(),
			email: z.string(),
		}),
	})
	.meta({ id: "AdminFeedback" });

export const adminFeedbackPageSchema = z
	.object({
		items: z.array(adminFeedbackSchema),
		nextCursor: z.string().nullable(),
		counts: z.object({
			total: z.int().min(0),
			unread: z.int().min(0),
			read: z.int().min(0),
			archived: z.int().min(0),
		}),
	})
	.meta({ id: "AdminFeedbackPage" });

export const feedbackParamsSchema = z.object({ id: idSchema });

export const setFeedbackStatusSchema = feedbackParamsSchema.extend({
	status: feedbackStatusSchema,
});

export const setFeedbackNoteSchema = feedbackParamsSchema.extend({
	/** null clears the note. Stored exactly as sent. */
	note: userText("feedback.adminNote", 2000).nullable(),
});
