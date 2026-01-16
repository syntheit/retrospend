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
				_count: {
					select: {
						expenses: true,
						createdInviteCodes: true,
					},
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
			expenseCount: user._count.expenses,
			inviteCodesCount: user._count.createdInviteCodes,
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
				throw new Error("User does not have a credential account");
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
				throw new Error("Cannot disable your own account");
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
				throw new Error("Cannot delete your own account");
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
