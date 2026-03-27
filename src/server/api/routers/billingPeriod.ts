import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	assertGuestProjectScope,
	createTRPCRouter,
	guestOrProtectedProcedure,
	protectedProcedure,
} from "~/server/api/trpc";
import {
	createNotification,
	resolveParticipantName,
} from "~/server/services/notifications";
import { logAudit } from "~/server/services/shared-expenses/audit-log";
import { requireProjectRole } from "~/server/services/shared-expenses/project-permissions";
import type { Prisma, PrismaClient } from "~prisma";

// ── helpers ──────────────────────────────────────────────────────────────────

function computeBillingPeriodEnd(
	start: Date,
	cycleLength: string,
	cycleDays?: number | null,
): Date {
	const end = new Date(start);
	switch (cycleLength) {
		case "WEEKLY":
			end.setDate(end.getDate() + 7);
			break;
		case "BIWEEKLY":
			end.setDate(end.getDate() + 14);
			break;
		case "MONTHLY":
			end.setMonth(end.getMonth() + 1);
			break;
		case "CUSTOM":
			end.setDate(end.getDate() + (cycleDays ?? 30));
			break;
	}
	return end;
}

function getISOWeek(date: Date): number {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() + 4 - (d.getDay() || 7));
	const yearStart = new Date(d.getFullYear(), 0, 1);
	return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function computePeriodLabel(
	startDate: Date,
	endDate: Date,
	cycleLength: string,
): string {
	switch (cycleLength) {
		case "MONTHLY":
			return startDate.toLocaleDateString("en-US", {
				month: "long",
				year: "numeric",
				timeZone: "UTC",
			});
		case "WEEKLY": {
			const weekNum = getISOWeek(startDate);
			return `Week ${weekNum}, ${startDate.getUTCFullYear()}`;
		}
		default: {
			const formatDate = (date: Date) =>
				date.toLocaleDateString("en-US", {
					month: "short",
					day: "numeric",
					year: "numeric",
					timeZone: "UTC",
				});
			return `${formatDate(startDate)} – ${formatDate(endDate)}`;
		}
	}
}

async function runInBillingTransaction<T>(
	db: PrismaClient,
	userId: string,
	callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	return db.$transaction(async (tx) => {
		await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true),
		                            set_config('role', 'retrospend_app', true)`;
		return callback(tx);
	});
}

// ── Auto-close utility ────────────────────────────────────────────────────────

/**
 * Find all OPEN billing periods that have passed their end date on projects
 * with billingAutoClose = true, and transition them to CLOSING, auto-creating
 * the next OPEN period.
 *
 * Uses the project creator as the actor. Safe to call lazily (e.g. in list)
 * or from a scheduled task.
 */
export async function checkAndAutoClosePeriods(
	db: PrismaClient,
	actorUserId: string,
): Promise<void> {
	const now = new Date();

	const stalePeriods = await db.billingPeriod.findMany({
		where: {
			status: "OPEN",
			endDate: { lt: now },
			project: { billingAutoClose: true },
		},
		include: {
			project: {
				select: {
					id: true,
					billingCycleLength: true,
					billingCycleDays: true,
					createdById: true,
				},
			},
		},
	});

	for (const period of stalePeriods) {
		const { project } = period;
		if (!project.billingCycleLength) continue;

		try {
			await runInBillingTransaction(db, project.createdById, async (tx) => {
				const nextStart = new Date(period.endDate);
				nextStart.setDate(nextStart.getDate() + 1);
				const nextEnd = computeBillingPeriodEnd(
					nextStart,
					project.billingCycleLength!,
					project.billingCycleDays,
				);
				const label = computePeriodLabel(
					nextStart,
					nextEnd,
					project.billingCycleLength!,
				);

				// Use updateMany with status guard to prevent concurrent auto-close race
				const updateResult = await tx.billingPeriod.updateMany({
					where: { id: period.id, status: "OPEN" },
					data: {
						status: "CLOSING",
						closedById: project.createdById,
						closedAt: now,
					},
				});

				// Already closed by another concurrent request: skip
				if (updateResult.count === 0) return;

				await tx.billingPeriod.create({
					data: {
						projectId: project.id,
						label,
						startDate: nextStart,
						endDate: nextEnd,
						status: "OPEN",
					},
				});

				await logAudit(tx, {
					actor: {
						participantType: "user",
						participantId: project.createdById,
					},
					action: "PERIOD_CLOSED",
					targetType: "BILLING_PERIOD",
					targetId: period.id,
					changes: {
						autoClose: true,
						previousStatus: "OPEN",
						newStatus: "CLOSING",
					},
					projectId: project.id,
				});
			});
		} catch (err) {
			console.error(`Auto-close failed for billing period ${period.id}:`, err);
		}
	}
}

// ── Notification helper ───────────────────────────────────────────────────────

async function notifyPeriodClosed(
	db: PrismaClient,
	projectId: string,
	periodLabel: string,
	actorUserId: string,
	periodId: string,
) {
	const project = await db.project.findUnique({
		where: { id: projectId },
		select: { name: true },
	});
	const projectName = project?.name ?? "project";
	const actorName = await resolveParticipantName("user", actorUserId);

	const participants = await db.projectParticipant.findMany({
		where: { projectId, participantType: "user" },
	});

	for (const p of participants) {
		if (p.participantId === actorUserId) continue;
		await createNotification({
			userId: p.participantId,
			type: "PERIOD_CLOSED",
			title: "Period closed",
			body: `${actorName} closed '${periodLabel}' in '${projectName}'. Review and verify your expenses.`,
			data: { projectId, periodId },
		});
	}
}

// ── Router ────────────────────────────────────────────────────────────────────

export const billingPeriodRouter = createTRPCRouter({
	list: guestOrProtectedProcedure
		.input(z.object({ projectId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			assertGuestProjectScope(ctx.participant, input.projectId);
			const { participantType, participantId } = ctx.participant;

			await requireProjectRole(
				ctx.db,
				input.projectId,
				participantType,
				participantId,
				"VIEWER",
			);

			// Lazy auto-close: only applicable for authenticated users (organizer-level action)
			if (participantType === "user") {
				await checkAndAutoClosePeriods(ctx.db, participantId);
			}

			const periods = await ctx.db.billingPeriod.findMany({
				where: { projectId: input.projectId },
				orderBy: { startDate: "desc" },
				include: {
					_count: { select: { sharedTransactions: true } },
				},
			});

			if (periods.length === 0) return [];

			const periodIds = periods.map((p) => p.id);

			// Batch participant counts by period (2 groupBy + 1 shared lookup instead of 2N counts)
			const countParticipantsByPeriod = async (
				extraWhere?: Record<string, unknown>,
			): Promise<Map<string, number>> => {
				const rows = await ctx.db.splitParticipant.groupBy({
					by: ["transactionId"],
					where: {
						transaction: { billingPeriodId: { in: periodIds } },
						...extraWhere,
					},
					_count: { id: true },
				});
				if (rows.length === 0) return new Map();
				const txPeriods = await ctx.db.sharedTransaction.findMany({
					where: { id: { in: rows.map((r) => r.transactionId) } },
					select: { id: true, billingPeriodId: true },
				});
				const txToPeriod = new Map(txPeriods.map((t) => [t.id, t.billingPeriodId]));
				const map = new Map<string, number>();
				for (const row of rows) {
					const pId = txToPeriod.get(row.transactionId);
					if (pId) map.set(pId, (map.get(pId) ?? 0) + row._count.id);
				}
				return map;
			};

			const [unverifiedCounts, totalCounts] = await Promise.all([
				countParticipantsByPeriod({ verificationStatus: "PENDING" as const }),
				countParticipantsByPeriod(),
			]);

			return periods.map((period) => ({
				id: period.id,
				label: period.label,
				startDate: period.startDate,
				endDate: period.endDate,
				status: period.status,
				closedAt: period.closedAt,
				settledAt: period.settledAt,
				transactionCount: period._count.sharedTransactions,
				unverifiedCount: unverifiedCounts.get(period.id) ?? 0,
				totalParticipantCount: totalCounts.get(period.id) ?? 0,
			}));
		}),

	detail: guestOrProtectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				periodId: z.string().min(1),
			}),
		)
		.query(async ({ ctx, input }) => {
			assertGuestProjectScope(ctx.participant, input.projectId);
			const { participantType, participantId } = ctx.participant;

			await requireProjectRole(
				ctx.db,
				input.projectId,
				participantType,
				participantId,
				"VIEWER",
			);

			const period = await ctx.db.billingPeriod.findUnique({
				where: { id: input.periodId },
				include: {
					sharedTransactions: {
						include: {
							splitParticipants: true,
							category: {
								select: { id: true, name: true, color: true },
							},
						},
						orderBy: { date: "desc" },
					},
				},
			});

			if (!period || period.projectId !== input.projectId) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Billing period not found",
				});
			}

			// Summary stats
			const totalSpent = period.sharedTransactions.reduce(
				(sum, tx) => sum + Number(tx.amount),
				0,
			);

			const categoryBreakdown: Record<
				string,
				{ name: string; color: string; total: number }
			> = {};
			for (const tx of period.sharedTransactions) {
				if (tx.categoryId && tx.category) {
					const key = tx.categoryId;
					if (!categoryBreakdown[key]) {
						categoryBreakdown[key] = {
							name: tx.category.name,
							color: tx.category.color,
							total: 0,
						};
					}
					categoryBreakdown[key]!.total += Number(tx.amount);
				}
			}

			const participantTotals: Record<string, number> = {};
			for (const tx of period.sharedTransactions) {
				for (const sp of tx.splitParticipants) {
					const key = `${sp.participantType}:${sp.participantId}`;
					participantTotals[key] =
						(participantTotals[key] ?? 0) + Number(sp.shareAmount);
				}
			}

			return {
				...period,
				totalSpent,
				categoryBreakdown: Object.entries(categoryBreakdown).map(
					([categoryId, v]) => ({ categoryId, ...v }),
				),
				participantTotals: Object.entries(participantTotals).map((entry) => {
					const [key, total] = entry as [string, number];
					const [participantType, participantId] = key.split(":") as [
						string,
						string,
					];
					return { participantType, participantId, total };
				}),
			};
		}),

	closeCurrent: protectedProcedure
		.input(z.object({ projectId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			const project = await ctx.db.project.findUnique({
				where: { id: input.projectId },
				select: {
					id: true,
					type: true,
					billingCycleLength: true,
					billingCycleDays: true,
					billingClosePermission: true,
				},
			});

			if (!project) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Project not found",
				});
			}

			if (project.type !== "ONGOING") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Only ongoing projects have billing periods",
				});
			}

			if (!project.billingCycleLength) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Project has no billing cycle configured",
				});
			}

			// Check permission based on project's billingClosePermission setting
			const requiredRole =
				project.billingClosePermission === "ORGANIZER_ONLY"
					? "ORGANIZER"
					: "CONTRIBUTOR";
			await requireProjectRole(
				ctx.db,
				input.projectId,
				"user",
				userId,
				requiredRole,
			);

			// Find all OPEN periods (must be exactly one)
			const openPeriods = await ctx.db.billingPeriod.findMany({
				where: { projectId: input.projectId, status: "OPEN" },
			});

			if (openPeriods.length === 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "No open billing period to close",
				});
			}

			if (openPeriods.length > 1) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message:
						"Multiple open billing periods detected: data integrity issue. Contact support.",
				});
			}

			const period = openPeriods[0]!;
			const now = new Date();

			// Compute next period dates and label
			const nextStart = new Date(period.endDate);
			nextStart.setDate(nextStart.getDate() + 1);
			const nextEnd = computeBillingPeriodEnd(
				nextStart,
				project.billingCycleLength,
				project.billingCycleDays,
			);
			const label = computePeriodLabel(
				nextStart,
				nextEnd,
				project.billingCycleLength,
			);

			const result = await runInBillingTransaction(
				ctx.db,
				userId,
				async (tx) => {
					// Use updateMany with status guard to prevent concurrent close race
					const updateResult = await tx.billingPeriod.updateMany({
						where: { id: period.id, status: "OPEN" },
						data: {
							status: "CLOSING",
							closedById: userId,
							closedAt: now,
						},
					});

					if (updateResult.count === 0) {
						throw new TRPCError({
							code: "CONFLICT",
							message: "This period was already closed by another user",
						});
					}

					const closedPeriod = await tx.billingPeriod.findUniqueOrThrow({
						where: { id: period.id },
					});

					const newPeriod = await tx.billingPeriod.create({
						data: {
							projectId: input.projectId,
							label,
							startDate: nextStart,
							endDate: nextEnd,
							status: "OPEN",
						},
					});

					await logAudit(tx, {
						actor: { participantType: "user", participantId: userId },
						action: "PERIOD_CLOSED",
						targetType: "BILLING_PERIOD",
						targetId: period.id,
						changes: {
							previousStatus: "OPEN",
							newStatus: "CLOSING",
							nextPeriodId: newPeriod.id,
						},
						projectId: input.projectId,
					});

					return { closedPeriod, newPeriod };
				},
			);

			// Notify all user participants of the project (excluding the actor)
			notifyPeriodClosed(
				ctx.db,
				input.projectId,
				period.label,
				userId,
				result.closedPeriod.id,
			).catch((err) =>
				console.error("[Notification Error] PERIOD_CLOSED:", err),
			);

			return result;
		}),

	settlePeriod: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				periodId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			await requireProjectRole(
				ctx.db,
				input.projectId,
				"user",
				userId,
				"ORGANIZER",
			);

			const period = await ctx.db.billingPeriod.findUnique({
				where: { id: input.periodId },
			});

			if (!period || period.projectId !== input.projectId) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Billing period not found",
				});
			}

			if (period.status !== "CLOSING") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Cannot settle a period with status "${period.status}". Period must be in CLOSING status.`,
				});
			}

			// Ensure all split participants in this period have verified
			const unverifiedCount = await ctx.db.splitParticipant.count({
				where: {
					transaction: { billingPeriodId: input.periodId },
					verificationStatus: { in: ["PENDING", "REJECTED"] },
				},
			});

			if (unverifiedCount > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Not all expenses have been verified. ${unverifiedCount} participant${unverifiedCount === 1 ? "" : "s"} still need${unverifiedCount === 1 ? "s" : ""} to verify.`,
				});
			}

			const now = new Date();

			return runInBillingTransaction(ctx.db, userId, async (tx) => {
				const updatedPeriod = await tx.billingPeriod.update({
					where: { id: input.periodId },
					data: { status: "SETTLED", settledAt: now },
				});

				// Lock all transactions in this period
				await tx.sharedTransaction.updateMany({
					where: { billingPeriodId: input.periodId },
					data: { isLocked: true },
				});

				await logAudit(tx, {
					actor: { participantType: "user", participantId: userId },
					action: "SETTLED",
					targetType: "BILLING_PERIOD",
					targetId: input.periodId,
					changes: { previousStatus: "CLOSING", newStatus: "SETTLED" },
					projectId: input.projectId,
				});

				return updatedPeriod;
			});
		}),

	updateLabel: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				periodId: z.string().min(1),
				label: z.string().min(1).max(100),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			// Requirers organizer to rename, or maybe contributor? Let's use ORGANIZER since it's a project-level setting,
			// or maybe the same permissions as closing a period? Let's check project.billingClosePermission.
			const project = await ctx.db.project.findUnique({
				where: { id: input.projectId },
				select: { billingClosePermission: true },
			});

			if (!project) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Project not found",
				});
			}

			const requiredRole =
				project.billingClosePermission === "ORGANIZER_ONLY"
					? "ORGANIZER"
					: "CONTRIBUTOR";

			await requireProjectRole(
				ctx.db,
				input.projectId,
				"user",
				userId,
				requiredRole,
			);

			const period = await ctx.db.billingPeriod.findUnique({
				where: { id: input.periodId },
			});

			if (!period || period.projectId !== input.projectId) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Billing period not found",
				});
			}

			return runInBillingTransaction(ctx.db, userId, async (tx) => {
				const updatedPeriod = await tx.billingPeriod.update({
					where: { id: input.periodId },
					data: { label: input.label },
				});

				// Optionally log audit for renaming
				await logAudit(tx, {
					actor: { participantType: "user", participantId: userId },
					action: "EDITED",
					targetType: "BILLING_PERIOD",
					targetId: input.periodId,
					changes: { previousLabel: period.label, newLabel: input.label },
					projectId: input.projectId,
				});

				return updatedPeriod;
			});
		}),
});
