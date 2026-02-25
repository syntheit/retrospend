import { TRPCError } from "@trpc/server";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { adminProcedure, createTRPCRouter } from "~/server/api/trpc";
import { getAppSettings, updateAppSettings } from "~/server/services/settings";

export const adminRouter = createTRPCRouter({
	getStats: adminProcedure.query(async ({ ctx }) => {
		const { db } = ctx;

		const userCount = await db.user.count();

		return { userCount };
	}),

	listUsers: adminProcedure.query(async ({ ctx }) => {
		const { db } = ctx;

		const users = await db.user.findMany({
			select: {
				id: true,
				username: true,
				email: true,
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
			const { db } = ctx;

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

			await db.user.update({
				where: { id: input.userId },
				data: { isActive: false },
			});

			return { success: true };
		}),

	enableUser: adminProcedure
		.input(z.object({ userId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const { db } = ctx;

			await db.user.update({
				where: { id: input.userId },
				data: { isActive: true },
			});

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

			await db.user.delete({
				where: { id: input.userId },
			});

			return { success: true };
		}),

	getSettings: adminProcedure.query(async () => {
		const settings = await getAppSettings();
		return {
			inviteOnlyEnabled: settings.inviteOnlyEnabled,
			allowAllUsersToGenerateInvites: settings.allowAllUsersToGenerateInvites,
		};
	}),

	updateSettings: adminProcedure
		.input(
			z.object({
				inviteOnlyEnabled: z.boolean(),
				allowAllUsersToGenerateInvites: z.boolean(),
			}),
		)
		.mutation(async ({ input }) => {
			const settings = await updateAppSettings({
				inviteOnlyEnabled: input.inviteOnlyEnabled,
				allowAllUsersToGenerateInvites: input.allowAllUsersToGenerateInvites,
			});
			return {
				inviteOnlyEnabled: settings.inviteOnlyEnabled,
				allowAllUsersToGenerateInvites: settings.allowAllUsersToGenerateInvites,
			};
		}),
});
