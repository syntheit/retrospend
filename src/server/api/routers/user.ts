import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
	deleteOwnAccount,
	isLastAdminAccount,
	previewOwnAccountDeletion,
} from "~/server/services/account-deletion.service";
import { changeOwnPassword } from "~/server/services/account-security.service";
import { updateProfile } from "~/server/services/profile.service";

export const userRouter = createTRPCRouter({
	updateProfile: protectedProcedure
		.input(
			z
				.object({
					name: z.string().min(1, "Name is required").max(100),
					username: z
						.string()
						.min(1, "Username is required")
						.max(50)
						.regex(
							/^[a-zA-Z0-9]+$/,
							"Username can only contain letters and numbers",
						)
						.transform((v) => v.toLowerCase()),
					email: z
						.email("Invalid email address")
						.max(254)
						.transform((v) => v.toLowerCase().trim()),
					password: z
						.string()
						.min(8, "Password must be at least 8 characters")
						.max(255)
						.regex(
							/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
							"Password must contain at least one uppercase letter, one lowercase letter, and one number",
						)
						.optional(),
					currentPassword: z
						.string()
						.min(8, "Current password is required when changing password")
						.optional(),
				})
				.refine((data) => !data.password || !!data.currentPassword, {
					error: "Current password is required",
					path: ["currentPassword"],
				}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			// The same services as profile.update and PATCH /api/v1/profile: the
			// app role cannot write the email, username or password columns, and a
			// new email needs the current password.
			const { user } = await updateProfile(
				db,
				{
					id: session.user.id,
					username: session.user.username,
					email: session.user.email,
				},
				{
					name: input.name,
					username: input.username,
					email: input.email,
					currentPassword: input.currentPassword,
				},
			);

			if (input.password?.trim() && input.currentPassword) {
				await changeOwnPassword({
					userId: session.user.id,
					keepSessionId: session.session.id,
					currentPassword: input.currentPassword,
					newPassword: input.password,
				});
			}

			return user;
		}),

	previewAccountDeletion: protectedProcedure.query(async ({ ctx }) => ({
		...(await previewOwnAccountDeletion(ctx.session.user.id)),
		// Web only: the sheet says so up front instead of after the password.
		onlyAdmin: await isLastAdminAccount(ctx.session.user),
	})),

	deleteAccount: protectedProcedure
		.input(
			z.object({
				password: z.string().min(1, "Password is required"),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await deleteOwnAccount(ctx.session.user, input.password);

			return { success: true };
		}),
});
