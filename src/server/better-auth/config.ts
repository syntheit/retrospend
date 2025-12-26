import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { headers } from "next/headers";
import { env } from "~/env";
import { DEFAULT_CATEGORIES } from "~/lib/constants";
import { db } from "~/server/db";
import { isInviteOnlyEnabled } from "~/server/services/settings";

export const auth = betterAuth({
	secret: env.BETTER_AUTH_SECRET,
	database: prismaAdapter(db, {
		provider: "postgresql", // or "sqlite" or "mysql"
	}),
	trustedOrigins: [env.NEXT_PUBLIC_APP_URL],
	emailAndPassword: {
		enabled: true,
	},
	user: {
		additionalFields: {
			username: {
				type: "string",
				required: true,
			},
			role: {
				type: "string",
				required: true,
				defaultValue: "USER",
			},
			isActive: {
				type: "boolean",
				required: true,
				defaultValue: true,
			},
		},
	},
	databaseHooks: {
		user: {
			create: {
				before: async (_user) => {
					// Check if invite-only mode is enabled
					const inviteOnlyEnabled = await isInviteOnlyEnabled();

					if (inviteOnlyEnabled) {
						// Check invite code for new users
						const headersList = await headers();
						const inviteCode = headersList
							.get("cookie")
							?.split(";")
							.find((c) => c.trim().startsWith("retro_invite_code="))
							?.split("=")[1];

						if (!inviteCode) {
							throw new Error("Invite code required for new users");
						}

						// Verify invite code exists, is active, and unused
						const validInvite = await db.inviteCode.findFirst({
							where: {
								code: inviteCode,
								isActive: true,
								usedById: null,
								OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
							},
						});

						if (!validInvite) {
							throw new Error("Invalid or expired invite code");
						}
					}
				},
				after: async (user) => {
					// Check if invite-only mode is enabled
					const inviteOnlyEnabled = await isInviteOnlyEnabled();

					if (inviteOnlyEnabled) {
						// Mark invite code as used
						const headersList = await headers();
						const inviteCode = headersList
							.get("cookie")
							?.split(";")
							.find((c) => c.trim().startsWith("retro_invite_code="))
							?.split("=")[1];

						if (inviteCode) {
							await db.inviteCode.updateMany({
								where: { code: inviteCode },
								data: {
									usedAt: new Date(),
									isActive: false,
									usedById: user.id,
								},
							});
						}
					}

					// First Born Logic: Promote first user to ADMIN
					const userCount = await db.user.count();
					if (userCount === 1) {
						await db.user.update({
							where: { id: user.id },
							data: { role: "ADMIN" },
						});
					}

					// Seed default categories for the new user
					await db.category.createMany({
						data: DEFAULT_CATEGORIES.map((category) => ({
							name: category.name,
							color: category.color,
							userId: user.id,
						})),
					});
				},
			},
		},
		session: {
			create: {
				before: async (session) => {
					// Kill Switch Logic: Block sign-in for inactive users
					const user = await db.user.findUnique({
						where: { id: session.userId },
						select: { isActive: true },
					});

					if (!user?.isActive) {
						throw new Error("Account is deactivated");
					}
				},
			},
		},
	},
	baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:1997",
});

export type Session = typeof auth.$Infer.Session;
