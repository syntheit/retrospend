import { TRPCError } from "@trpc/server";
import { hashPassword } from "better-auth/crypto";
import crypto from "crypto";
import { z } from "zod";
import { env } from "~/env";
import { adminProcedure, createTRPCRouter } from "~/server/api/trpc";
import { anonymizeAndDeleteUser } from "~/server/services/user-deletion.service";
import {
	getPasswordChangedAlertTemplate,
	getPasswordResetEmailTemplate,
	getTestEmailTemplate,
	getVerificationEmailTemplate,
} from "~/server/email-templates";
import { sendEmail } from "~/server/mailer";
import { getAiUsageSummary } from "~/server/services/ai-access.service";
import { deleteFile, getStorageSize } from "~/server/storage";
import { logEventAsync } from "~/server/services/audit.service";
import { IntegrationService } from "~/server/services/integration.service";
import { getAppSettings, updateAppSettings } from "~/server/services/settings";

export const adminRouter = createTRPCRouter({
	getStats: adminProcedure.query(async ({ ctx }) => {
		const { db } = ctx;

		const userCount = await db.user.count();

		return { userCount };
	}),

	getServerStats: adminProcedure.query(async ({ ctx }) => {
		const { db } = ctx;

		// Get database size in bytes
		const dbSizeResult = await db.$queryRaw<Array<{ size: bigint }>>`
			SELECT pg_database_size(current_database()) as size
		`;
		const dbSizeBytes = Number(dbSizeResult[0]?.size ?? 0);

		// Get upload storage size in bytes
		let storageSizeBytes = 0;
		try {
			storageSizeBytes = await getStorageSize();
		} catch {
			// Storage may not be configured; return 0
		}

		// Get app uptime in seconds
		const uptimeSeconds = process.uptime();

		return {
			databaseSize: dbSizeBytes,
			storageSize: storageSizeBytes,
			uptime: uptimeSeconds,
		};
	}),

	getAuditLogPrivacyMode: adminProcedure.query(async () => {
		const settings = await getAppSettings();
		return {
			mode: settings.auditPrivacyMode.toLowerCase() as
				| "minimal"
				| "anonymized"
				| "full",
		};
	}),

	getEventLogs: adminProcedure
		.input(
			z.object({
				limit: z.number().min(1).max(100).default(50),
				offset: z.number().min(0).default(0),
				eventType: z
					.enum([
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
					])
					.optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { db } = ctx;

			const where = input.eventType ? { eventType: input.eventType } : {};

			const [logs, total] = await Promise.all([
				db.eventLog.findMany({
					where,
					include: {
						user: {
							select: {
								id: true,
								username: true,
								email: true,
							},
						},
					},
					orderBy: {
						timestamp: "desc",
					},
					take: input.limit,
					skip: input.offset,
				}),
				db.eventLog.count({ where }),
			]);

			return {
				logs,
				total,
				hasMore: input.offset + input.limit < total,
			};
		}),

	getEventLogsCursor: adminProcedure
		.input(
			z.object({
				limit: z.number().min(1).max(100).default(50),
				cursor: z.string().optional(),
				eventType: z
					.enum([
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
					])
					.optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { db } = ctx;

			const where = {
				...(input.eventType ? { eventType: input.eventType } : {}),
				...(input.cursor
					? { timestamp: { lt: new Date(input.cursor) } }
					: {}),
			};

			const logs = await db.eventLog.findMany({
				where,
				include: {
					user: {
						select: { id: true, username: true, email: true },
					},
				},
				orderBy: { timestamp: "desc" },
				take: input.limit + 1,
			});

			let nextCursor: string | undefined;
			if (logs.length > input.limit) {
				const lastItem = logs.pop()!;
				nextCursor = lastItem.timestamp.toISOString();
			}

			return { logs, nextCursor };
		}),

	listUsers: adminProcedure.query(async ({ ctx }) => {
		const { db } = ctx;

		const users = await db.user.findMany({
			select: {
				id: true,
				username: true,
				email: true,
				emailVerified: true,
				twoFactorEnabled: true,
				role: true,
				isActive: true,
				createdAt: true,
				externalAiAllowed: true,
				_count: {
					select: {
						expenses: true,
						createdInviteCodes: true,
						budgets: true,
						recurringTemplates: true,
						assetAccounts: true,
					},
				},
				expenses: {
					select: {
						date: true,
					},
					orderBy: {
						date: "desc",
					},
					take: 1,
				},
			},
			orderBy: {
				createdAt: "desc",
			},
		});

		return users.map((user) => ({
			id: user.id,
			username: user.username,
			email: user.email,
			emailVerified: user.emailVerified,
			twoFactorEnabled: !!user.twoFactorEnabled,
			role: user.role,
			isActive: user.isActive,
			createdAt: user.createdAt,
			expenseCount: user._count.expenses,
			inviteCodesCount: user._count.createdInviteCodes,
			lastExpenseDate: user.expenses[0]?.date ?? null,
			hasBudget: user._count.budgets > 0,
			hasRecurring: user._count.recurringTemplates > 0,
			hasWealth: user._count.assetAccounts > 0,
			externalAiAllowed: user.externalAiAllowed,
		}));
	}),

	resetPassword: adminProcedure
		.input(z.object({ userId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;

			const targetUser = await db.user.findUnique({
				where: { id: input.userId },
				select: { email: true, username: true },
			});

			const newPassword = crypto.randomBytes(12).toString("base64url");
			const hashedPassword = await hashPassword(newPassword);

			const updatedAccount = await db.account.updateMany({
				where: {
					userId: input.userId,
					providerId: "credential",
				},
				data: {
					password: hashedPassword,
				},
			});

			if (updatedAccount.count === 0) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "User does not have a credential account",
				});
			}

			// Invalidate all sessions for the target user
			await db.session.deleteMany({
				where: { userId: input.userId },
			});

			// Log the password reset
			logEventAsync({
				eventType: "PASSWORD_RESET",
				userId: input.userId,
				metadata: {
					resetBy: session.user.id,
					resetByUsername: session.user.username,
					targetUsername: targetUser?.username,
				},
			});

			return {
				success: true,
				newPassword,
			};
		}),

	disableUser: adminProcedure
		.input(z.object({ userId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;

			if (session.user.id === input.userId) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Cannot disable your own account",
				});
			}

			const user = await db.user.update({
				where: { id: input.userId },
				data: { isActive: false },
				select: { username: true },
			});

			// Log the account disable
			logEventAsync({
				eventType: "ACCOUNT_DISABLED",
				userId: input.userId,
				metadata: {
					disabledBy: session.user.id,
					disabledByUsername: session.user.username,
					targetUsername: user.username,
				},
			});

			return { success: true };
		}),

	enableUser: adminProcedure
		.input(z.object({ userId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;

			const user = await db.user.update({
				where: { id: input.userId },
				data: { isActive: true },
				select: { username: true },
			});

			// Log the account enable
			logEventAsync({
				eventType: "ACCOUNT_ENABLED",
				userId: input.userId,
				metadata: {
					enabledBy: session.user.id,
					enabledByUsername: session.user.username,
					targetUsername: user.username,
				},
			});

			return { success: true };
		}),

	markEmailVerified: adminProcedure
		.input(z.object({ userId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const { db } = ctx;

			await db.user.update({
				where: { id: input.userId },
				data: { emailVerified: true },
			});

			return { success: true };
		}),

	toggleEmailVerification: adminProcedure
		.input(z.object({ userId: z.string().min(1), verified: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;

			const user = await db.user.update({
				where: { id: input.userId },
				data: { emailVerified: input.verified },
				select: { username: true },
			});

			// Log email verification change (only when verified becomes true)
			if (input.verified) {
				logEventAsync({
					eventType: "EMAIL_VERIFIED",
					userId: input.userId,
					metadata: {
						verifiedBy: session.user.id,
						verifiedByUsername: session.user.username,
						targetUsername: user.username,
					},
				});
			}

			return { success: true };
		}),

	deleteUser: adminProcedure
		.input(z.object({ userId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;

			if (session.user.id === input.userId) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Cannot delete your own account",
				});
			}

			const user = await db.user.findUnique({
				where: { id: input.userId },
				select: { username: true, email: true, avatarPath: true },
			});

			await anonymizeAndDeleteUser(
				db,
				input.userId,
				user?.email ?? "",
				user?.avatarPath ?? null,
			);

			// Log the account deletion
			logEventAsync({
				eventType: "ACCOUNT_DELETED",
				userId: input.userId,
				metadata: {
					deletedBy: session.user.id,
					deletedByUsername: session.user.username,
					targetUsername: user?.username,
					targetEmail: user?.email,
				},
			});

			return { success: true };
		}),

	getSettings: adminProcedure.query(async () => {
		const settings = await getAppSettings();
		return {
			inviteOnlyEnabled: settings.inviteOnlyEnabled,
			allowAllUsersToGenerateInvites: settings.allowAllUsersToGenerateInvites,
			enableEmail: settings.enableEmail,
			auditPrivacyMode: settings.auditPrivacyMode,
			maxConcurrentImportJobs: settings.maxConcurrentImportJobs,
			enableFeedback: settings.enableFeedback,
		};
	}),

	updateSettings: adminProcedure
		.input(
			z.object({
				inviteOnlyEnabled: z.boolean().optional(),
				allowAllUsersToGenerateInvites: z.boolean().optional(),
				enableEmail: z.boolean().optional(),
				auditPrivacyMode: z
					.enum(["MINIMAL", "ANONYMIZED", "FULL"])
					.optional(),
				maxConcurrentImportJobs: z.number().int().min(1).max(50).optional(),
				enableFeedback: z.boolean().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const settings = await updateAppSettings(input);
			return {
				inviteOnlyEnabled: settings.inviteOnlyEnabled,
				allowAllUsersToGenerateInvites: settings.allowAllUsersToGenerateInvites,
				enableEmail: settings.enableEmail,
				auditPrivacyMode: settings.auditPrivacyMode,
				maxConcurrentImportJobs: settings.maxConcurrentImportJobs,
				enableFeedback: settings.enableFeedback,
			};
		}),

	getAiSettings: adminProcedure.query(async () => {
		const settings = await getAppSettings();
		return {
			defaultAiMode: settings.defaultAiMode,
			externalAiAccessMode: settings.externalAiAccessMode,
			monthlyAiTokenQuota: settings.monthlyAiTokenQuota,
			monthlyLocalAiTokenQuota: settings.monthlyLocalAiTokenQuota,
			monthlyExternalAiTokenQuota: settings.monthlyExternalAiTokenQuota,
			openRouterConfigured: !!env.OPENROUTER_API_KEY,
		};
	}),

	updateAiSettings: adminProcedure
		.input(
			z.object({
				defaultAiMode: z.enum(["LOCAL", "EXTERNAL"]).optional(),
				externalAiAccessMode: z.enum(["WHITELIST", "BLACKLIST"]).optional(),
				monthlyAiTokenQuota: z.number().int().min(0).optional(),
				monthlyLocalAiTokenQuota: z.number().int().min(0).optional(),
				monthlyExternalAiTokenQuota: z.number().int().min(0).optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const settings = await updateAppSettings(input);
			return {
				defaultAiMode: settings.defaultAiMode,
				externalAiAccessMode: settings.externalAiAccessMode,
				monthlyAiTokenQuota: settings.monthlyAiTokenQuota,
				monthlyLocalAiTokenQuota: settings.monthlyLocalAiTokenQuota,
				monthlyExternalAiTokenQuota: settings.monthlyExternalAiTokenQuota,
			};
		}),

	setUserAiAccess: adminProcedure
		.input(
			z.object({
				userId: z.string().min(1),
				externalAiAllowed: z.boolean().nullable(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;

			const user = await db.user.findUnique({
				where: { id: input.userId },
				select: { username: true, externalAiAllowed: true },
			});

			await db.user.update({
				where: { id: input.userId },
				data: { externalAiAllowed: input.externalAiAllowed },
			});

			logEventAsync({
				eventType: "ADMIN_AI_ACCESS_CHANGED",
				userId: input.userId,
				metadata: {
					changedBy: session.user.id,
					changedByUsername: session.user.username,
					targetUsername: user?.username,
					oldValue: user?.externalAiAllowed ?? null,
					newValue: input.externalAiAllowed,
				},
			});

			return { success: true };
		}),

	getAiUsageStats: adminProcedure
		.input(
			z
				.object({
					yearMonth: z
						.string()
						.regex(/^\d{4}-\d{2}$/)
						.optional(),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const { db } = ctx;
			const settings = await getAppSettings();
			const usages = await getAiUsageSummary(db, input?.yearMonth);
			return {
				quota: settings.monthlyAiTokenQuota,
				localQuota: settings.monthlyLocalAiTokenQuota,
				externalQuota: settings.monthlyExternalAiTokenQuota,
				usages: usages.map((u) => ({
					userId: u.userId,
					username: u.user.username,
					tokensUsed: u.tokensUsed,
					localTokensUsed: u.localTokensUsed,
					externalTokensUsed: u.externalTokensUsed,
					yearMonth: u.yearMonth,
				})),
			};
		}),

	sendTestEmail: adminProcedure
		.input(
			z.object({
				email: z.string().email(),
				type: z
					.enum([
						"basic",
						"password-reset",
						"credential-change",
						"email-verification",
					])
					.default("basic"),
			}),
		)
		.mutation(async ({ input }) => {
			try {
				let subject = "Retrospend SMTP Test";
				let html = getTestEmailTemplate();

				switch (input.type) {
					case "password-reset":
						subject = "Reset your Retrospend Password";
						html = getPasswordResetEmailTemplate(
							`${env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:1997"}/auth/reset-password?token=sample-token`,
						);
						break;
					case "credential-change":
						subject = "Security Alert: Your Retrospend Password was Changed";
						html = getPasswordChangedAlertTemplate();
						break;
					case "email-verification":
						subject = "Verify your Retrospend Account";
						html = getVerificationEmailTemplate(
							`${env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:1997"}/auth/verify?token=sample-token`,
						);
						break;
				}

				await sendEmail(
					input.email,
					subject,
					html,
					true, // bypassEnabledCheck
				);
				return { success: true, message: "Test email sent successfully" };
			} catch (error) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message:
						error instanceof Error
							? error.message
							: "Failed to send test email",
				});
			}
		}),

	generatePasswordResetLink: adminProcedure
		.input(z.object({ userId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;

			const user = await db.user.findUnique({
				where: { id: input.userId },
			});

			if (!user) {
				throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
			}

			const token = crypto.randomBytes(32).toString("hex");
			const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

			await db.passwordResetToken.create({
				data: {
					identifier: user.email,
					token,
					expires,
				},
			});

			// Security-critical: log every admin-generated reset link
			logEventAsync({
				eventType: "ADMIN_RESET_LINK_GENERATED",
				userId: input.userId,
				metadata: {
					generatedBy: session.user.id,
					generatedByUsername: session.user.username,
					targetUsername: user.username,
					targetEmail: user.email,
				},
			});

			const resetUrl = `${env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:1997"}/auth/reset-password?token=${token}`;
			return { resetUrl };
		}),

	removeUserAvatar: adminProcedure
		.input(z.object({ userId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;

			const user = await db.user.findUnique({
				where: { id: input.userId },
				select: { username: true, avatarPath: true },
			});

			if (!user) {
				throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
			}

			if (!user.avatarPath) {
				return { success: true }; // nothing to remove
			}

			// Delete from storage first (idempotent on failure)
			await deleteFile(user.avatarPath).catch(() => {});

			await db.user.update({
				where: { id: input.userId },
				data: { avatarPath: null },
			});

			logEventAsync({
				eventType: "USER_UPDATED",
				userId: input.userId,
				metadata: {
					updatedBy: session.user.id,
					updatedByUsername: session.user.username,
					targetUsername: user.username,
					field: "avatarPath",
					action: "removed",
				},
			});

			return { success: true };
		}),

	getBackupStatus: adminProcedure.query(async () => {
		try {
			const response = await IntegrationService.requestWorker(
				`${env.SIDECAR_URL}/backups`,
				{ timeout: 10000 },
			);
			return await response.json();
		} catch {
			return { available: false };
		}
	}),

	triggerBackup: adminProcedure.mutation(async () => {
		try {
			const response = await IntegrationService.requestWorker(
				`${env.SIDECAR_URL}/backups/run`,
				{ method: "POST", timeout: 300000 },
			);
			return await response.json();
		} catch (error) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Backup trigger failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			});
		}
	}),
});
