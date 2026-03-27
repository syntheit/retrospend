import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	adminProcedure,
	createTRPCRouter,
	protectedProcedure,
} from "~/server/api/trpc";
import { db } from "~/server/db";
import { getFeedbackNotificationTemplate } from "~/server/email-templates";
import { sendEmail } from "~/server/mailer";

export const feedbackRouter = createTRPCRouter({
	submit: protectedProcedure
		.input(
			z.object({
				message: z.string().min(1).max(5000),
				pageUrl: z.string(),
				userAgent: z.string().optional(),
				viewportSize: z.string().optional(),
				appVersion: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			const recentCount = await ctx.db.feedback.count({
				where: {
					userId,
					createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
				},
			});
			if (recentCount >= 5) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message:
						"You can only submit 5 feedback entries per hour. Please try again later.",
				});
			}

			const feedback = await ctx.db.feedback.create({
				data: {
					userId,
					message: input.message,
					pageUrl: input.pageUrl,
					userAgent: input.userAgent,
					viewportSize: input.viewportSize,
					appVersion: input.appVersion,
				},
			});

			// Send email notification to admins (skip if submitter is admin)
			if (ctx.session.user.role !== "ADMIN") {
				try {
					const admins = await db.user.findMany({
						where: { role: "ADMIN", isActive: true },
						select: { email: true },
					});

					const userName =
						ctx.session.user.name || ctx.session.user.email;
					const html = getFeedbackNotificationTemplate(
						userName,
						input.message,
						input.pageUrl,
						feedback.createdAt.toISOString(),
					);

					await Promise.allSettled(
						admins.map((admin) =>
							sendEmail(
								admin.email,
								`New feedback from ${userName}`,
								html,
							),
						),
					);
				} catch {
					// Don't fail feedback submission if email fails
				}
			}

			return { success: true };
		}),

	list: adminProcedure
		.input(
			z.object({
				status: z
					.enum(["unread", "read", "archived"])
					.optional(),
				cursor: z.string().optional(),
				limit: z.number().min(1).max(100).default(20),
			}),
		)
		.query(async ({ ctx, input }) => {
			const where = input.status ? { status: input.status } : {};

			const [items, unread, read, archived] = await Promise.all([
				ctx.db.feedback.findMany({
					where,
					take: input.limit + 1,
					...(input.cursor
						? { cursor: { id: input.cursor }, skip: 1 }
						: {}),
					orderBy: { createdAt: "desc" },
					include: {
						user: {
							select: {
								id: true,
								name: true,
								email: true,
								image: true,
								avatarPath: true,
							},
						},
					},
				}),
				ctx.db.feedback.count({ where: { status: "unread" } }),
				ctx.db.feedback.count({ where: { status: "read" } }),
				ctx.db.feedback.count({ where: { status: "archived" } }),
			]);

			let nextCursor: string | undefined;
			if (items.length > input.limit) {
				const next = items.pop()!;
				nextCursor = next.id;
			}

			return {
				items,
				nextCursor,
				counts: { total: unread + read + archived, unread, read, archived },
			};
		}),

	unreadCount: adminProcedure.query(async ({ ctx }) => {
		const count = await ctx.db.feedback.count({
			where: { status: "unread" },
		});
		return { count };
	}),

	updateStatus: adminProcedure
		.input(
			z.object({
				id: z.string(),
				status: z.enum(["unread", "read", "archived"]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await ctx.db.feedback.update({
				where: { id: input.id },
				data: { status: input.status },
			});
			return { success: true };
		}),

	addNote: adminProcedure
		.input(
			z.object({
				id: z.string(),
				note: z.string().max(2000),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await ctx.db.feedback.update({
				where: { id: input.id },
				data: { adminNote: input.note.trim() || null },
			});
			return { success: true };
		}),

	delete: adminProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.db.feedback.delete({ where: { id: input.id } });
			return { success: true };
		}),
});
