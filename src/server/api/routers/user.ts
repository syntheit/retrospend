import { TRPCError } from "@trpc/server";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const userRouter = createTRPCRouter({
	updateProfile: protectedProcedure
		.input(
			z
				.object({
					name: z.string().min(1, "Name is required"),
					username: z.string().min(1, "Username is required"),
					email: z.string().email("Invalid email address"),
					password: z
						.string()
						.min(8, "Password must be at least 8 characters")
						.optional(),
					currentPassword: z
						.string()
						.min(8, "Current password is required when changing password")
						.optional(),
				})
				.refine((data) => !data.password || !!data.currentPassword, {
					message: "Current password is required",
					path: ["currentPassword"],
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

			if (input.email !== session.user.email) {
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

			const updatedUser = await db.user.update({
				where: { id: session.user.id },
				data: {
					name: input.name,
					username: input.username,
					email: input.email,
				},
				select: {
					id: true,
					name: true,
					username: true,
					email: true,
				},
			});

			if (input.password?.trim()) {
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
					password: input.currentPassword ?? "",
					hash: credentialAccount.password,
				});

				if (!isCurrentValid) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Current password is incorrect",
					});
				}

				const hashedPassword = await hashPassword(input.password);

				await db.account.updateMany({
					where: {
						userId: session.user.id,
						providerId: "credential",
					},
					data: {
						password: hashedPassword,
					},
				});
			}

			return updatedUser;
		}),

	deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
		const { session, db } = ctx;

		await db.user.delete({
			where: { id: session.user.id },
		});

		return { success: true };
	}),
});
