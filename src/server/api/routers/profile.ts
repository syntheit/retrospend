import { TRPCError } from "@trpc/server";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { z } from "zod";
import { env } from "~/env";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getAppSettings } from "~/server/services/settings";
import { sumExpensesForCurrency } from "./shared-currency";

export const profileRouter = createTRPCRouter({
	update: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1, "Name is required").max(100),
				username: z
					.string()
					.min(1, "Username is required")
					.max(50)
					.regex(
						/^[a-z0-9_-]+$/,
						"Username can only contain lowercase letters, numbers, underscores, and hyphens",
					)
					.transform((v) => v.toLowerCase()),
				email: z
					.string()
					.email("Invalid email address")
					.max(254)
					.transform((v) => v.toLowerCase().trim()),
				currentPassword: z.string().min(1).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			if (input.username !== session.user.username) {
				const existingUsername = await db.user.findUnique({
					where: { username: input.username },
				});
				if (existingUsername) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "Username is already taken",
					});
				}
			}

			const isEmailChange = input.email !== session.user.email;

			if (isEmailChange) {
				// Require password verification for email changes
				if (!input.currentPassword) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Current password is required to change email",
					});
				}

				const credentialAccount = await db.account.findFirst({
					where: { userId: session.user.id, providerId: "credential" },
				});
				if (!credentialAccount?.password) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Password verification is not available for this account",
					});
				}

				const isValid = await verifyPassword({
					password: input.currentPassword,
					hash: credentialAccount.password,
				});
				if (!isValid) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Current password is incorrect",
					});
				}

				const existingEmail = await db.user.findUnique({
					where: { email: input.email },
				});
				if (existingEmail) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "Email is already in use",
					});
				}
			}

			// Determine if email should be marked unverified
			const settings = await getAppSettings();
			const shouldUnverify =
				isEmailChange && !!env.SMTP_HOST && settings.enableEmail;

			return await db.user.update({
				where: { id: session.user.id },
				data: {
					name: input.name,
					username: input.username,
					email: input.email,
					...(shouldUnverify ? { emailVerified: false } : {}),
				},
				select: {
					id: true,
					name: true,
					username: true,
					email: true,
				},
			});
		}),

	changePassword: protectedProcedure
		.input(
			z
				.object({
					currentPassword: z.string().min(1, "Current password is required"),
					newPassword: z
						.string()
						.min(8, "Password must be at least 8 characters")
						.max(255)
						.regex(
							/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
							"Password must contain at least one uppercase letter, one lowercase letter, and one number",
						),
					confirmPassword: z.string().min(1, "Please confirm your password"),
				})
				.refine((data) => data.newPassword === data.confirmPassword, {
					message: "Passwords do not match",
					path: ["confirmPassword"],
				}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const credentialAccount = await db.account.findFirst({
				where: {
					userId: session.user.id,
					providerId: "credential",
				},
			});

			if (!credentialAccount?.password) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Password change is not available for this account",
				});
			}

			const isCurrentValid = await verifyPassword({
				password: input.currentPassword,
				hash: credentialAccount.password,
			});

			if (!isCurrentValid) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Current password is incorrect",
				});
			}

			const hashedPassword = await hashPassword(input.newPassword);

			await db.account.updateMany({
				where: {
					userId: session.user.id,
					providerId: "credential",
				},
				data: {
					password: hashedPassword,
				},
			});

			// Invalidate all other sessions to force re-login
			await db.session.deleteMany({
				where: {
					userId: session.user.id,
					id: { not: session.session.id },
				},
			});

			return { success: true };
		}),
	getLifetimeStats: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;
		const userId = session.user.id;

		const user = await db.user.findUnique({
			where: { id: userId },
			select: { createdAt: true, homeCurrency: true },
		});

		if (!user) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "User not found",
			});
		}

		const totalEntries = await db.expense.count({
			where: { userId, status: "FINALIZED" },
		});

		const { total: lifetimeSpend } = await sumExpensesForCurrency(
			db,
			{ userId },
			user.homeCurrency,
		);

		return {
			lifetimeSpend,
			totalEntries,
			joinedAt: user.createdAt,
			homeCurrency: user.homeCurrency,
		};
	}),
});
