import { TRPCError } from "@trpc/server";
import { hashPassword } from "better-auth/crypto";
import crypto from "crypto";
import { z } from "zod";
import { env } from "~/env";
import { adminProcedure, createTRPCRouter } from "~/server/api/trpc";
import { sendEmail } from "~/server/mailer";
import { getAppSettings, updateAppSettings } from "~/server/services/settings";
import { logEventAsync } from "~/server/services/audit.service";

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

		// Get app uptime in seconds
		const uptimeSeconds = process.uptime();

		return {
			databaseSize: dbSizeBytes,
			uptime: uptimeSeconds,
		};
	}),

	getAuditLogPrivacyMode: adminProcedure.query(() => {
		const mode = (process.env.AUDIT_PRIVACY_MODE || "minimal") as
			| "minimal"
			| "anonymized"
			| "full";
		return { mode };
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
		}));
	}),

	resetPassword: adminProcedure
		.input(z.object({ userId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;

			const targetUser = await db.user.findUnique({
				where: { id: input.userId },
				select: { email: true, username: true },
			});

			const newPassword = Math.random().toString(36).substring(2, 10);
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
		.input(z.object({ userId: z.string() }))
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
		.input(z.object({ userId: z.string() }))
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
		.input(z.object({ userId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const { db } = ctx;

			await db.user.update({
				where: { id: input.userId },
				data: { emailVerified: true },
			});

			return { success: true };
		}),

	toggleEmailVerification: adminProcedure
		.input(z.object({ userId: z.string(), verified: z.boolean() }))
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
		.input(z.object({ userId: z.string() }))
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
				select: { username: true, email: true },
			});

			await db.user.delete({
				where: { id: input.userId },
			});

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
		};
	}),

	updateSettings: adminProcedure
		.input(
			z.object({
				inviteOnlyEnabled: z.boolean(),
				allowAllUsersToGenerateInvites: z.boolean(),
				enableEmail: z.boolean(),
			}),
		)
		.mutation(async ({ input }) => {
			const settings = await updateAppSettings({
				inviteOnlyEnabled: input.inviteOnlyEnabled,
				allowAllUsersToGenerateInvites: input.allowAllUsersToGenerateInvites,
				enableEmail: input.enableEmail,
			});
			return {
				inviteOnlyEnabled: settings.inviteOnlyEnabled,
				allowAllUsersToGenerateInvites: settings.allowAllUsersToGenerateInvites,
				enableEmail: settings.enableEmail,
			};
		}),

	sendTestEmail: adminProcedure
		.input(z.object({ email: z.string().email() }))
		.mutation(async ({ input }) => {
			try {
				await sendEmail(
					input.email,
					"Retrospend SMTP Test",
					"<h1>Success!</h1><p>Your SMTP configuration for Retrospend is working perfectly.</p>",
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
		.input(z.object({ userId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const { db } = ctx;

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

			const resetUrl = `${env.NEXT_PUBLIC_APP_URL || "http://localhost:1997"}/auth/reset-password?token=${token}`;
			return { resetUrl };
		}),
});
