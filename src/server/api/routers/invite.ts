import { z } from "zod";
import {
	adminProcedure,
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import { isAllowAllUsersToGenerateInvitesEnabled } from "~/server/services/settings";

/**
 * Generates a random 8-character invite code using uppercase letters and numbers
 */
function generateInviteCode(): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	let result = "";
	for (let i = 0; i < 8; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}

export const inviteRouter = createTRPCRouter({
	list: adminProcedure
		.input(
			z.object({
				status: z.enum(["all", "active", "used"]).default("active"),
				page: z.number().min(1).default(1),
				pageSize: z.number().min(1).max(100).default(10),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { db } = ctx;
			const { status, page, pageSize } = input;

			const where: { usedAt?: null | { not: null } } = {};
			if (status === "active") {
				where.usedAt = null;
			} else if (status === "used") {
				where.usedAt = { not: null };
			}

			const [totalCount, inviteCodes] = await Promise.all([
				db.inviteCode.count({ where }),
				db.inviteCode.findMany({
					where,
					include: {
						createdBy: {
							select: {
								username: true,
								name: true,
							},
						},
						usedBy: {
							select: {
								username: true,
								name: true,
							},
						},
					},
					orderBy: {
						createdAt: "desc",
					},
					skip: (page - 1) * pageSize,
					take: pageSize,
				}),
			]);

			return {
				items: inviteCodes.map((code) => ({
					id: code.id,
					code: code.code,
					isActive: code.isActive,
					usedAt: code.usedAt,
					expiresAt: code.expiresAt,
					createdAt: code.createdAt,
					createdBy: code.createdBy,
					usedBy: code.usedBy,
					status: code.usedAt ? "Used" : "Active",
				})),
				pagination: {
					totalCount,
					page,
					pageSize,
					totalPages: Math.ceil(totalCount / pageSize),
				},
			};
		}),

	generate: adminProcedure.mutation(async ({ ctx }) => {
		const { db, session } = ctx;

		let code: string;
		let attempts = 0;
		const maxAttempts = 10;

		do {
			if (attempts >= maxAttempts) {
				throw new Error(
					"Failed to generate unique invite code after multiple attempts",
				);
			}
			code = generateInviteCode();
			attempts++;
		} while (
			await db.inviteCode.findUnique({
				where: { code },
			})
		);

		const inviteCode = await db.inviteCode.create({
			data: {
				code,
				createdById: session.user.id,
			},
		});

		return {
			code: inviteCode.code,
			createdAt: inviteCode.createdAt,
		};
	}),

	validate: publicProcedure
		.input(z.object({ code: z.string() }))
		.query(async ({ ctx, input }) => {
			const { db } = ctx;

			const inviteCode = await db.inviteCode.findUnique({
				where: { code: input.code },
			});

			const isValid = inviteCode?.isActive && inviteCode.usedAt === null;

			return {
				valid: isValid,
			};
		}),

	delete: adminProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const { db } = ctx;
			const inviteCode = await db.inviteCode.findUnique({
				where: { id: input.id },
			});

			if (!inviteCode) {
				throw new Error("Invite code not found");
			}

			await db.inviteCode.delete({
				where: { id: input.id },
			});

			return { success: true };
		}),

	listUserCodes: protectedProcedure
		.input(
			z.object({
				status: z.enum(["all", "active", "used"]).default("active"),
				page: z.number().min(1).default(1),
				pageSize: z.number().min(1).max(100).default(10),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { db, session } = ctx;
			const { status, page, pageSize } = input;

			const isEnabled = await isAllowAllUsersToGenerateInvitesEnabled();
			if (!isEnabled) {
				throw new Error("Invite code generation is not enabled for users");
			}

			const where: { createdById: string; usedAt?: null | { not: null } } = {
				createdById: session.user.id,
			};

			if (status === "active") {
				where.usedAt = null;
			} else if (status === "used") {
				where.usedAt = { not: null };
			}

			const [totalCount, inviteCodes] = await Promise.all([
				db.inviteCode.count({ where }),
				db.inviteCode.findMany({
					where,
					include: {
						createdBy: {
							select: {
								username: true,
								name: true,
							},
						},
						usedBy: {
							select: {
								username: true,
								name: true,
							},
						},
					},
					orderBy: {
						createdAt: "desc",
					},
					skip: (page - 1) * pageSize,
					take: pageSize,
				}),
			]);

			return {
				items: inviteCodes.map((code) => ({
					id: code.id,
					code: code.code,
					isActive: code.isActive,
					usedAt: code.usedAt,
					expiresAt: code.expiresAt,
					createdAt: code.createdAt,
					createdBy: code.createdBy,
					usedBy: code.usedBy,
					status: code.usedAt ? "Used" : "Active",
				})),
				pagination: {
					totalCount,
					page,
					pageSize,
					totalPages: Math.ceil(totalCount / pageSize),
				},
			};
		}),

	generateUserCode: protectedProcedure.mutation(async ({ ctx }) => {
		const { db, session } = ctx;

		const isEnabled = await isAllowAllUsersToGenerateInvitesEnabled();
		if (!isEnabled) {
			throw new Error("Invite code generation is not enabled for users");
		}

		let code: string;
		let attempts = 0;
		const maxAttempts = 10;

		do {
			if (attempts >= maxAttempts) {
				throw new Error(
					"Failed to generate unique invite code after multiple attempts",
				);
			}
			code = generateInviteCode();
			attempts++;
		} while (
			await db.inviteCode.findUnique({
				where: { code },
			})
		);

		const inviteCode = await db.inviteCode.create({
			data: {
				code,
				createdById: session.user.id,
			},
		});

		return {
			code: inviteCode.code,
			createdAt: inviteCode.createdAt,
		};
	}),

	deleteUserCode: protectedProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;

			const isEnabled = await isAllowAllUsersToGenerateInvitesEnabled();
			if (!isEnabled) {
				throw new Error("Invite code management is not enabled for users");
			}

			const inviteCode = await db.inviteCode.findFirst({
				where: {
					id: input.id,
					createdById: session.user.id,
				},
			});

			if (!inviteCode) {
				throw new Error("Invite code not found or access denied");
			}

			await db.inviteCode.delete({
				where: { id: input.id },
			});

			return { success: true };
		}),
});
