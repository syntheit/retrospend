import { z } from "zod";
import {
	adminProcedure,
	createTRPCRouter,
	publicProcedure,
} from "~/server/api/trpc";

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
	/**
	 * List all invite codes (Admin only)
	 */
	list: adminProcedure.query(async ({ ctx }) => {
		const { db } = ctx;

		const inviteCodes = await db.inviteCode.findMany({
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
		});

		return inviteCodes.map((code) => ({
			id: code.id,
			code: code.code,
			isActive: code.isActive,
			usedAt: code.usedAt,
			expiresAt: code.expiresAt,
			createdAt: code.createdAt,
			createdBy: code.createdBy,
			usedBy: code.usedBy,
			status: code.usedAt ? "Used" : "Active",
		}));
	}),

	/**
	 * Generate a new invite code (Admin only)
	 */
	generate: adminProcedure.mutation(async ({ ctx }) => {
		const { db, session } = ctx;

		// Generate a unique code
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

		// Create the invite code
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

	/**
	 * Validate an invite code (Public)
	 */
	validate: publicProcedure
		.input(z.object({ code: z.string() }))
		.query(async ({ ctx, input }) => {
			const { db } = ctx;

			const inviteCode = await db.inviteCode.findUnique({
				where: { code: input.code },
			});

			// Check if code exists, is active, and hasn't been used
			const isValid = inviteCode?.isActive && inviteCode.usedAt === null;

			return {
				valid: isValid,
			};
		}),

	/**
	 * Delete an invite code (Admin only)
	 */
	delete: adminProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const { db } = ctx;

			// Check if the invite code exists
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
});
