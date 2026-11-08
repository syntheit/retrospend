import {
	FEEDBACK_CATEGORIES,
	feedbackDiagnosticsSchema,
	scrubReport,
} from "@retrospend/api-contract";
import { userText, userTextOrEmpty } from "@retrospend/api-contract/common";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	adminListProcedure,
	adminProcedure,
	createTRPCRouter,
	protectedProcedure,
} from "~/server/api/trpc";
import { db } from "~/server/db";
import { getFeedbackNotificationTemplate } from "~/server/email-templates";
import { emailSubject } from "~/server/email-copy";
import { sendEmail } from "~/server/mailer";
import { deleteFile } from "~/server/storage";

export const feedbackRouter = createTRPCRouter({
	submit: protectedProcedure
		.input(
			z.object({
				message: userText("feedback.message", 5000),
				pageUrl: z.string(),
				userAgent: z.string().optional(),
				viewportSize: z.string().optional(),
				appVersion: z.string().optional(),
				category: z.enum(FEEDBACK_CATEGORIES).default("other"),
				diagnostics: feedbackDiagnosticsSchema.optional(),
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
					category: input.category,
					// The same scrubber POST /error-reports runs: what the app sent
					// as "recent errors" is never kept raw.
					diagnostics: input.diagnostics
						? {
								...input.diagnostics,
								recentErrors: input.diagnostics.recentErrors?.map(scrubReport),
							}
						: undefined,
				},
			});

			// Send email notification to admins (skip if submitter is admin)
			if (ctx.session.user.role !== "ADMIN") {
				try {
					const admins = await db.user.findMany({
						where: { role: "ADMIN", isActive: true },
						select: { email: true },
					});

					const userName = ctx.session.user.name || ctx.session.user.email;
					const html = getFeedbackNotificationTemplate(
						userName,
						input.message,
						input.pageUrl,
						feedback.createdAt.toISOString(),
					);

					await Promise.allSettled(
						admins.map((admin) =>
							sendEmail(admin.email, emailSubject.feedback(userName), html),
						),
					);
				} catch {
					// Don't fail feedback submission if email fails
				}
			}

			return { success: true, id: feedback.id };
		}),

	list: adminListProcedure("feedback")
		.input(
			z.object({
				status: z.enum(["unread", "read", "archived"]).optional(),
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
					...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
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
				note: userTextOrEmpty("feedback.adminNote", 2000),
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
			const row = await ctx.db.feedback.findUnique({
				where: { id: input.id },
				select: { screenshotPath: true },
			});
			await ctx.db.feedback.delete({ where: { id: input.id } });
			// The picture goes with the entry; a failed delete never fails this.
			if (row?.screenshotPath) {
				try {
					await deleteFile(row.screenshotPath);
				} catch (err) {
					console.warn("Failed to delete feedback screenshot:", err);
				}
			}
			return { success: true };
		}),

	/** Errors the mobile app sent, newest first. Admins only; already scrubbed. */
	errorReports: adminListProcedure("error_reports")
		.input(
			z.object({
				cursor: z.string().optional(),
				limit: z.number().min(1).max(100).default(20),
			}),
		)
		.query(async ({ ctx, input }) => {
			const [rows, total] = await Promise.all([
				ctx.db.errorReport.findMany({
					take: input.limit + 1,
					...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
					orderBy: [{ createdAt: "desc" }, { id: "desc" }],
					include: { user: { select: { id: true, name: true } } },
				}),
				ctx.db.errorReport.count(),
			]);
			let nextCursor: string | undefined;
			if (rows.length > input.limit) nextCursor = rows.pop()?.id;
			return { items: rows, nextCursor, total };
		}),

	deleteErrorReport: adminProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.db.errorReport.delete({ where: { id: input.id } });
			return { success: true };
		}),
});
