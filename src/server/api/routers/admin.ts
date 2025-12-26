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
		}));
	}),

	resetPassword: adminProcedure
		.input(z.object({ userId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const { db } = ctx;

			// Generate a random password (8 characters)
			const newPassword = Math.random().toString(36).substring(2, 10);

			// Hash the password
			const hashedPassword = await hashPassword(newPassword);

			// Find and update the user's credential account
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
				newPassword, // Return the plain password for the admin to share
			};
		}),

	disableUser: adminProcedure
		.input(z.object({ userId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;

			// Prevent admin from disabling themselves
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

			// Prevent admin from deleting themselves
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
		};
	}),

	updateSettings: adminProcedure
		.input(z.object({
			inviteOnlyEnabled: z.boolean(),
		}))
		.mutation(async ({ input }) => {
			const settings = await updateAppSettings({
				inviteOnlyEnabled: input.inviteOnlyEnabled,
			});
			return {
				inviteOnlyEnabled: settings.inviteOnlyEnabled,
			};
		}),
});
