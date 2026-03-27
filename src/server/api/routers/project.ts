import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { env } from "~/env";
import { getImageUrl } from "~/server/storage";
import {
	assertGuestProjectScope,
	createTRPCRouter,
	guestOrProtectedProcedure,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import {
	createNotification,
	resolveParticipantName,
} from "~/server/services/notifications";
import { notificationEmail } from "~/server/email-templates";
import { sendEmail } from "~/server/mailer";
import { logAudit } from "~/server/services/shared-expenses/audit-log";
import { computePeriodLabel } from "~/server/api/routers/billingPeriod";
import { computeTransactionStatus } from "~/server/services/shared-expenses/verification.service";
import { computeSettlementPlan } from "~/server/services/shared-expenses/group-settlement";
import { requireProjectRole } from "~/server/services/shared-expenses/project-permissions";
import type { ParticipantType, Prisma, PrismaClient } from "~prisma";

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

async function resolveParticipantNames(
	db: PrismaClient,
	participants: Array<{
		id: string;
		participantType: string;
		participantId: string;
		role: string;
		joinedAt: Date;
	}>,
) {
	// Collect IDs by type for batch fetching
	const userIds: string[] = [];
	const shadowIds: string[] = [];
	const guestIds: string[] = [];

	for (const p of participants) {
		if (p.participantType === "user" && p.participantId !== "DELETED_USER") {
			userIds.push(p.participantId);
		} else if (p.participantType === "shadow") {
			shadowIds.push(p.participantId);
		} else if (p.participantType === "guest") {
			guestIds.push(p.participantId);
		}
	}

	// Batch fetch all at once (3 queries instead of N)
	const [users, shadows, guests] = await Promise.all([
		userIds.length > 0
			? db.user.findMany({
					where: { id: { in: userIds } },
					select: { id: true, name: true, username: true, image: true, avatarPath: true },
				})
			: [],
		shadowIds.length > 0
			? db.shadowProfile.findMany({
					where: { id: { in: shadowIds } },
					select: { id: true, name: true, email: true },
				})
			: [],
		guestIds.length > 0
			? db.guestSession.findMany({
					where: { id: { in: guestIds } },
					select: { id: true, name: true, email: true },
				})
			: [],
	]);

	const userMap = new Map(users.map((u) => [u.id, u]));
	const shadowMap = new Map(shadows.map((s) => [s.id, s]));
	const guestMap = new Map(guests.map((g) => [g.id, g]));

	return participants.map((p) => {
		if (p.participantType === "user") {
			if (p.participantId === "DELETED_USER") {
				return { ...p, name: "Deleted User", email: null, username: null, avatarUrl: null };
			}
			const user = userMap.get(p.participantId);
			return {
				...p,
				name: user?.name ?? "Unknown",
				email: null,
				username: user?.username ?? null,
				avatarUrl: getImageUrl(user?.avatarPath ?? null) ?? user?.image ?? null,
			};
		}
		if (p.participantType === "shadow") {
			const shadow = shadowMap.get(p.participantId);
			return {
				...p,
				name: shadow?.name ?? "Unknown",
				email: shadow?.email ?? null,
				username: null,
				avatarUrl: null,
			};
		}
		// guest
		const guest = guestMap.get(p.participantId);
		return {
			...p,
			name: guest?.name ?? "Unknown",
			email: guest?.email ?? null,
			username: null,
			avatarUrl: null,
		};
	});
}

async function runInProjectTransaction<T>(
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

// ── input schemas ─────────────────────────────────────────────────────────────

const participantRefSchema = z.object({
	participantType: z.enum(["user", "guest", "shadow"]),
	participantId: z.string().min(1),
});

const projectRoleSchema = z.enum([
	"ORGANIZER",
	"EDITOR",
	"CONTRIBUTOR",
	"VIEWER",
]);

const createProjectSchema = z.object({
	name: z.string().min(1).max(191),
	type: z.enum(["TRIP", "ONGOING", "SOLO", "ONE_TIME", "GENERAL"]),
	description: z.string().max(500).optional(),
	budgetAmount: z.number().positive().optional(),
	budgetCurrency: z.string().min(1).max(10).optional(),
	primaryCurrency: z.string().min(1).max(10).default("USD"),
	startDate: z.date().optional(),
	endDate: z.date().optional(),
	visibility: z
		.enum(["PRIVATE", "PUBLIC"])
		.default("PRIVATE"),
	billingCycleLength: z
		.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "CUSTOM"])
		.optional(),
	billingCycleDays: z.number().int().positive().optional(),
	billingAutoClose: z.boolean().default(false),
	billingCloseReminderDays: z.number().int().min(0).default(3),
	billingClosePermission: z
		.enum(["ORGANIZER_ONLY", "ANY_PARTICIPANT"])
		.default("ORGANIZER_ONLY"),
});

// ── router ────────────────────────────────────────────────────────────────────

export const projectRouter = createTRPCRouter({
	create: protectedProcedure
		.input(createProjectSchema)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			const project = await runInProjectTransaction(
				ctx.db,
				userId,
				async (tx) => {
					const created = await tx.project.create({
						data: {
							name: input.name,
							type: input.type,
							description: input.description ?? null,
							budgetAmount: input.budgetAmount ?? null,
							budgetCurrency: input.budgetCurrency ?? null,
							primaryCurrency: input.primaryCurrency,
							createdById: userId,
							visibility: input.visibility,
							startDate: input.startDate ?? null,
							endDate: input.endDate ?? null,
							billingCycleLength: input.billingCycleLength ?? null,
							billingCycleDays: input.billingCycleDays ?? null,
							billingAutoClose: input.billingAutoClose,
							billingCloseReminderDays: input.billingCloseReminderDays,
							billingClosePermission: input.billingClosePermission,
						},
						include: { participants: true },
					});

					// Creator is always ORGANIZER
					await tx.projectParticipant.create({
						data: {
							projectId: created.id,
							participantType: "user",
							participantId: userId,
							role: "ORGANIZER",
						},
					});

					// Auto-create first billing period for ONGOING projects with a cycle
					if (input.type === "ONGOING" && input.billingCycleLength) {
						const periodStart = input.startDate ?? new Date();
						const periodEnd = computeBillingPeriodEnd(
							periodStart,
							input.billingCycleLength,
							input.billingCycleDays,
						);
						const label = computePeriodLabel(periodStart, periodEnd, input.billingCycleLength);
						await tx.billingPeriod.create({
							data: {
								projectId: created.id,
								label,
								startDate: periodStart,
								endDate: periodEnd,
								status: "OPEN",
							},
						});
					}

					await logAudit(tx, {
						actor: { participantType: "user", participantId: userId },
						action: "CREATED",
						targetType: "PROJECT",
						targetId: created.id,
						changes: { name: input.name, type: input.type },
						projectId: created.id,
					});

					return created;
				},
			);

			// Re-fetch with fresh participant list (created in same tx above)
			return ctx.db.project.findUniqueOrThrow({
				where: { id: project.id },
				include: { participants: true, billingPeriods: true },
			});
		}),

	list: protectedProcedure
		.input(
			z.object({
				status: z.enum(["ACTIVE", "SETTLED", "ARCHIVED"]).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			const projects = await ctx.db.project.findMany({
				where: {
					participants: {
						some: {
							participantType: "user",
							participantId: userId,
						},
					},
					...(input.status ? { status: input.status } : {}),
				},
				include: {
					_count: { select: { participants: true, sharedTransactions: true } },
					participants: {
						take: 5,
						orderBy: { joinedAt: "asc" },
					},
					billingPeriods: {
						where: { status: "OPEN" },
						take: 1,
						orderBy: { startDate: "desc" },
					},
				},
				orderBy: { updatedAt: "desc" },
			});

			// Batch: collect all participants across all projects for a single resolveParticipantNames call
			const allParticipants = projects.flatMap((p) =>
				p.participants.map((pp) => ({ ...pp, _projectId: p.id })),
			);

			// Batch-resolve names (3 queries total, regardless of project count)
			const resolvedAll = await resolveParticipantNames(
				ctx.db,
				allParticipants,
			);

			// Group resolved participants back by project
			const participantsByProject = new Map<string, typeof resolvedAll>();
			for (const rp of resolvedAll) {
				const pid = (rp as typeof rp & { _projectId: string })._projectId;
				const list = participantsByProject.get(pid) ?? [];
				list.push(rp);
				participantsByProject.set(pid, list);
			}

			// Batch: single groupBy for totalSpent across all projects
			const projectIds = projects.map((p) => p.id);
			const spentGroupBy = projectIds.length > 0
				? await ctx.db.sharedTransaction.groupBy({
						by: ["projectId"],
						where: { projectId: { in: projectIds } },
						_sum: { amount: true },
					})
				: [];
			const spentMap = new Map(
				spentGroupBy.map((g) => [g.projectId, Number(g._sum.amount ?? 0)]),
			);

			const enriched = projects.map((p) => {
				const participantDetails = participantsByProject.get(p.id) ?? [];
				const myParticipant = participantDetails.find(
					(pp) =>
						pp.participantType === "user" && pp.participantId === userId,
				);

				// Find the raw participant record to get excludeFromAnalytics
				const rawMyParticipant = p.participants.find(
					(pp) =>
						pp.participantType === "user" && pp.participantId === userId,
				);

				return {
					...p,
					participants: participantDetails,
					myRole: myParticipant?.role ?? null,
					excludeFromAnalytics: rawMyParticipant?.excludeFromAnalytics ?? false,
					totalSpent: spentMap.get(p.id) ?? 0,
					currentBillingPeriod: p.billingPeriods[0] ?? null,
				};
			});

			// Sort: ACTIVE first, then by updatedAt desc (already ordered)
			return enriched.sort((a, b) => {
				if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
				if (a.status !== "ACTIVE" && b.status === "ACTIVE") return 1;
				return 0;
			});
		}),

	detail: guestOrProtectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			assertGuestProjectScope(ctx.participant, input.id);
			const { participantType, participantId } = ctx.participant;

			// Validate membership (any role)
			await requireProjectRole(
				ctx.db,
				input.id,
				participantType,
				participantId,
				"VIEWER",
			);

			const project = await ctx.db.project.findUnique({
				where: { id: input.id },
				include: {
					participants: true,
					billingPeriods: {
						orderBy: { startDate: "desc" },
					},
				},
			});

			if (!project) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Project not found",
				});
			}

			// Resolve participant names
			const participants = await resolveParticipantNames(
				ctx.db,
				project.participants,
			);

			// Determine current participant's role
			const myParticipant =
				participantType === "viewerLink"
					? null
					: participants.find(
							(pp) =>
								pp.participantType === participantType &&
								pp.participantId === participantId,
						);
			const myRole =
				participantType === "viewerLink"
					? ("VIEWER" as const)
					: (myParticipant?.role ?? null);

			// Expense stats grouped by category
			const rawCategoryStats = await ctx.db.sharedTransaction.groupBy({
				by: ["categoryId"],
				where: { projectId: input.id },
				_sum: { amount: true },
				_count: { _all: true },
			});

			const totalSpent = rawCategoryStats.reduce(
				(sum, s) => sum + (s._sum.amount ? Number(s._sum.amount) : 0),
				0,
			);

			// Resolve category names/colors
			const categoryIds = rawCategoryStats
				.map((s) => s.categoryId)
				.filter((id): id is string => id !== null);
			const categories =
				categoryIds.length > 0
					? await ctx.db.category.findMany({
							where: { id: { in: categoryIds } },
							select: { id: true, name: true, color: true },
						})
					: [];
			const categoryMap = new Map(categories.map((c) => [c.id, c]));

			const categoryStats = rawCategoryStats.map((s) => {
				const cat = s.categoryId ? categoryMap.get(s.categoryId) : null;
				return {
					categoryId: s.categoryId,
					name: cat?.name ?? "Uncategorized",
					color: cat?.color ?? "gray",
					total: s._sum.amount ? Number(s._sum.amount) : 0,
					count: s._count._all,
				};
			});

			const currentBillingPeriod =
				project.type === "ONGOING"
					? (project.billingPeriods.find((p) => p.status === "OPEN") ?? null)
					: null;

			// Count unseen changes for the current participant
			// viewerLink participants are never split participants, so always 0
			const unseenChangesCount =
				participantType === "viewerLink"
					? 0
					: await ctx.db.splitParticipant.count({
							where: {
								transaction: { projectId: input.id },
								participantType,
								participantId,
								hasUnseenChanges: true,
							},
						});

			// Count transactions with any PENDING verification (project-wide)
			const pendingVerificationCount = await ctx.db.splitParticipant.count({
				where: {
					transaction: { projectId: input.id },
					verificationStatus: "PENDING",
				},
			});

			// Get the current participant's excludeFromAnalytics preference
			const rawMyParticipant = project.participants.find(
				(pp) =>
					pp.participantType === participantType &&
					pp.participantId === participantId,
			);

			return {
				...project,
				participants,
				categoryStats,
				totalSpent,
				currentBillingPeriod,
				unseenChangesCount,
				pendingVerificationCount,
				myRole,
				myParticipantType: participantType,
				myParticipantId: participantId,
				excludeFromAnalytics: rawMyParticipant?.excludeFromAnalytics ?? false,
			};
		}),

	updateAnalyticsExclusion: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				exclude: z.boolean(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			const updated = await ctx.db.projectParticipant.updateMany({
				where: {
					projectId: input.projectId,
					participantType: "user",
					participantId: userId,
				},
				data: { excludeFromAnalytics: input.exclude },
			});

			if (updated.count === 0) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "You are not a participant in this project",
				});
			}

			return { excludeFromAnalytics: input.exclude };
		}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				name: z.string().min(1).max(191).optional(),
				description: z.string().max(500).nullish(),
				budgetAmount: z.number().positive().nullish(),
				budgetCurrency: z.string().min(1).max(10).nullish(),
				primaryCurrency: z.string().min(1).max(10).optional(),
				startDate: z.date().nullish(),
				endDate: z.date().nullish(),
				status: z.enum(["ACTIVE", "SETTLED", "ARCHIVED"]).optional(),
				visibility: z.enum(["PRIVATE", "PUBLIC"]).optional(),
				billingCycleLength: z
					.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "CUSTOM"])
					.nullish(),
				billingCycleDays: z.number().int().positive().nullish(),
				billingAutoClose: z.boolean().optional(),
				billingCloseReminderDays: z.number().int().min(0).optional(),
				billingClosePermission: z
					.enum(["ORGANIZER_ONLY", "ANY_PARTICIPANT"])
					.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const { id, ...fields } = input;

			await requireProjectRole(ctx.db, id, "user", userId, "EDITOR");

			const existing = await ctx.db.project.findUniqueOrThrow({
				where: { id },
			});

			// Build field-level diff and update data
			const diff: Record<string, { old: unknown; new: unknown }> = {};
			const updateData: Record<string, unknown> = {};

			const trackField = (key: string, newVal: unknown) => {
				const oldVal = (existing as Record<string, unknown>)[key];
				if (newVal !== undefined && newVal !== oldVal) {
					diff[key] = { old: oldVal, new: newVal };
					updateData[key] = newVal;
				}
			};

			trackField("name", fields.name);
			trackField("description", fields.description);
			trackField("budgetAmount", fields.budgetAmount);
			trackField("budgetCurrency", fields.budgetCurrency);
			trackField("primaryCurrency", fields.primaryCurrency);
			trackField("startDate", fields.startDate);
			trackField("endDate", fields.endDate);
			trackField("status", fields.status);
			trackField("visibility", fields.visibility);
			trackField("billingCycleLength", fields.billingCycleLength);
			trackField("billingCycleDays", fields.billingCycleDays);
			trackField("billingAutoClose", fields.billingAutoClose);
			trackField("billingCloseReminderDays", fields.billingCloseReminderDays);
			trackField("billingClosePermission", fields.billingClosePermission);

			if (Object.keys(diff).length === 0) {
				return existing;
			}

			return runInProjectTransaction(ctx.db, userId, async (tx) => {
				const updated = await tx.project.update({
					where: { id },
					data: updateData as Prisma.ProjectUncheckedUpdateInput,
				});

				await logAudit(tx, {
					actor: { participantType: "user", participantId: userId },
					action: "EDITED",
					targetType: "PROJECT",
					targetId: id,
					changes: diff as Prisma.InputJsonValue,
					projectId: id,
				});

				return updated;
			});
		}),

	addParticipant: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				participantType: z.enum(["user", "guest", "shadow"]),
				participantId: z.string().min(1),
				role: projectRoleSchema.default("CONTRIBUTOR"),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			await requireProjectRole(
				ctx.db,
				input.projectId,
				"user",
				userId,
				"EDITOR",
			);

			// For shadow participants, verify the caller created the shadow profile.
			// Without this check, any organizer could add another user's shadow profile
			// and expose that profile's name/email to their project participants.
			if (input.participantType === "shadow") {
				const shadow = await ctx.db.shadowProfile.findUnique({
					where: { id: input.participantId },
					select: { createdById: true },
				});
				if (!shadow) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Shadow profile not found",
					});
				}
				if (shadow.createdById !== userId) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "You can only add shadow profiles you created",
					});
				}
			}

			// Check for duplicate (friendly error before hitting the unique constraint)
			const existing = await ctx.db.projectParticipant.findUnique({
				where: {
					projectId_participantType_participantId: {
						projectId: input.projectId,
						participantType: input.participantType,
						participantId: input.participantId,
					},
				},
			});
			if (existing) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "This participant is already in the project",
				});
			}

			const participant = await runInProjectTransaction(
				ctx.db,
				userId,
				async (tx) => {
					const p = await tx.projectParticipant.create({
						data: {
							projectId: input.projectId,
							participantType: input.participantType,
							participantId: input.participantId,
							role: input.role,
						},
					});

					await logAudit(tx, {
						actor: { participantType: "user", participantId: userId },
						action: "PARTICIPANT_ADDED",
						targetType: "PROJECT",
						targetId: input.projectId,
						changes: {
							participantType: input.participantType,
							participantId: input.participantId,
							role: input.role,
						},
						projectId: input.projectId,
					});

					return p;
				},
			);

			// Notify the added participant if they're a registered user
			if (input.participantType === "user") {
				const project = await ctx.db.project.findUnique({
					where: { id: input.projectId },
					select: { name: true },
				});
				const actorName = await resolveParticipantName("user", userId);
				createNotification({
					userId: input.participantId,
					type: "PARTICIPANT_ADDED",
					title: "Added to project",
					body: `${actorName} added you to '${project?.name ?? "a project"}'`,
					data: { projectId: input.projectId },
				}).catch((err) =>
					console.error("[Notification Error] PARTICIPANT_ADDED:", err),
				);
			}

			// Send invitation email to shadow profiles that have an email address
			if (input.participantType === "shadow") {
				const shadow = await ctx.db.shadowProfile.findUnique({
					where: { id: input.participantId },
					select: { name: true, email: true },
				});
				if (shadow?.email) {
					const project = await ctx.db.project.findUnique({
						where: { id: input.projectId },
						select: { name: true },
					});
					const actorName = await resolveParticipantName("user", userId);
					const projectName = project?.name ?? "a project";
					const appUrl = env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "";
					const title = "You've been added to a project";

					// Create a single-use magic link so the recipient can join directly
					const magicLinkRole =
						input.role === "ORGANIZER" ? "CONTRIBUTOR" : input.role;
					let joinUrl: string | undefined;
					try {
						const magicLink = await ctx.db.magicLink.create({
							data: {
								id: crypto.randomUUID(),
								projectId: input.projectId,
								roleGranted: magicLinkRole,
								createdById: userId,
								maxUses: 1,
							},
						});
						joinUrl = appUrl ? `${appUrl}/projects/${input.projectId}?invite=${magicLink.id}` : undefined;
					} catch (err) {
						console.error(
							"[Invitation] Failed to create magic link for shadow email:",
							err,
						);
					}

					const body = joinUrl
						? `${actorName} added you to '${projectName}' on Retrospend. Click the button below to join and view shared expenses.`
						: `${actorName} added you to '${projectName}' on Retrospend.${appUrl ? " Sign in or create an account to view and manage shared expenses." : ""}`;
					const html = notificationEmail({
						title,
						body,
						ctaUrl: joinUrl,
						ctaLabel: joinUrl ? "Join Project" : undefined,
					});
					sendEmail(shadow.email, `Retrospend: ${title}`, html).catch((err) =>
						console.error("[Notification Error] shadow PARTICIPANT_ADDED email:", err),
					);
				}
			}

			return participant;
		}),

	updateParticipantRole: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				participantType: z.enum(["user", "guest", "shadow"]),
				participantId: z.string().min(1),
				role: projectRoleSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			const callerParticipant = await requireProjectRole(
				ctx.db,
				input.projectId,
				"user",
				userId,
				"EDITOR",
			);

			// Cannot change own role
			if (input.participantType === "user" && input.participantId === userId) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You cannot change your own role",
				});
			}

			const target = await ctx.db.projectParticipant.findUnique({
				where: {
					projectId_participantType_participantId: {
						projectId: input.projectId,
						participantType: input.participantType,
						participantId: input.participantId,
					},
				},
			});

			if (!target) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Participant not found in this project",
				});
			}

			// Editors cannot change an Organizer's role
			if (callerParticipant.role !== "ORGANIZER" && target.role === "ORGANIZER") {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only an Organizer can change another Organizer's role",
				});
			}

			// Cannot demote project creator below ORGANIZER
			const project = await ctx.db.project.findUniqueOrThrow({
				where: { id: input.projectId },
				select: { createdById: true },
			});
			if (
				target.participantType === "user" &&
				target.participantId === project.createdById &&
				input.role !== "ORGANIZER"
			) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "The project creator cannot be demoted below Organizer",
				});
			}

			const oldRole = target.role;

			return runInProjectTransaction(ctx.db, userId, async (tx) => {
				const updated = await tx.projectParticipant.update({
					where: { id: target.id },
					data: { role: input.role },
				});

				await logAudit(tx, {
					actor: { participantType: "user", participantId: userId },
					action: "ROLE_CHANGED",
					targetType: "PROJECT",
					targetId: input.projectId,
					changes: {
						participantType: input.participantType,
						participantId: input.participantId,
						oldRole,
						newRole: input.role,
					},
					projectId: input.projectId,
				});

				return updated;
			});
		}),

	removeParticipant: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				participantType: z.enum(["user", "guest", "shadow"]),
				participantId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			const callerParticipant = await requireProjectRole(
				ctx.db,
				input.projectId,
				"user",
				userId,
				"EDITOR",
			);

			const project = await ctx.db.project.findUniqueOrThrow({
				where: { id: input.projectId },
				select: { createdById: true },
			});

			// Cannot remove project creator
			if (
				input.participantType === "user" &&
				input.participantId === project.createdById
			) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "The project creator cannot be removed",
				});
			}

			const target = await ctx.db.projectParticipant.findUnique({
				where: {
					projectId_participantType_participantId: {
						projectId: input.projectId,
						participantType: input.participantType,
						participantId: input.participantId,
					},
				},
			});

			if (!target) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Participant not found in this project",
				});
			}

			// Editors cannot remove an Organizer
			if (callerParticipant.role !== "ORGANIZER" && target.role === "ORGANIZER") {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only an Organizer can remove another Organizer",
				});
			}

			await runInProjectTransaction(ctx.db, userId, async (tx) => {
				await tx.projectParticipant.delete({ where: { id: target.id } });

				await logAudit(tx, {
					actor: { participantType: "user", participantId: userId },
					action: "PARTICIPANT_REMOVED",
					targetType: "PROJECT",
					targetId: input.projectId,
					changes: {
						participantType: input.participantType,
						participantId: input.participantId,
					},
					projectId: input.projectId,
				});
			});

			return { success: true };
		}),

	listExpenses: guestOrProtectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				billingPeriodId: z.string().optional(),
				page: z.number().int().positive().default(1),
				limit: z.number().int().positive().max(500).default(20),
			}),
		)
		.query(async ({ ctx, input }) => {
			assertGuestProjectScope(ctx.participant, input.projectId);
			const { participantType, participantId } = ctx.participant;
			const callerParticipant = await requireProjectRole(
				ctx.db,
				input.projectId,
				participantType,
				participantId,
				"VIEWER",
			);
			const callerRole = callerParticipant.role;

			const where: Prisma.SharedTransactionWhereInput = {
				projectId: input.projectId,
				...(input.billingPeriodId
					? { billingPeriodId: input.billingPeriodId }
					: {}),
			};

			const [transactions, total] = await Promise.all([
				ctx.db.sharedTransaction.findMany({
					where,
					include: {
						category: { select: { id: true, name: true, color: true, icon: true } },
						splitParticipants: {
							select: {
								id: true,
								participantType: true,
								participantId: true,
								shareAmount: true,
								verificationStatus: true,
								hasUnseenChanges: true,
							},
						},
					},
					orderBy: { date: "desc" },
					skip: (input.page - 1) * input.limit,
					take: input.limit,
				}),
				ctx.db.sharedTransaction.count({ where }),
			]);

			// Resolve payer names
			const enriched = await Promise.all(
				transactions.map(async (tx) => {
					let paidByName = "Unknown";
					let paidByAvatar: string | null = null;
					if (tx.paidByType === "user") {
						const u = await ctx.db.user.findUnique({
							where: { id: tx.paidById },
							select: { name: true, image: true, avatarPath: true },
						});
						paidByName = u?.name ?? "Unknown";
						paidByAvatar = getImageUrl(u?.avatarPath ?? null) ?? u?.image ?? null;
					} else if (tx.paidByType === "shadow") {
						const s = await ctx.db.shadowProfile.findUnique({
							where: { id: tx.paidById },
							select: { name: true },
						});
						paidByName = s?.name ?? "Unknown";
					} else {
						const g = await ctx.db.guestSession.findUnique({
							where: { id: tx.paidById },
							select: { name: true },
						});
						paidByName = g?.name ?? "Unknown";
					}

					// Determine status based on verification
					const status = tx.isLocked
						? "settled"
						: computeTransactionStatus(tx.splitParticipants);

					const isCreator =
						tx.createdByType === participantType &&
						tx.createdById === participantId;
					const canModifyTx =
						!tx.isLocked &&
						(callerRole === "ORGANIZER" ||
							callerRole === "EDITOR" ||
							(callerRole === "CONTRIBUTOR" && isCreator));

					return {
						id: tx.id,
						description: tx.description,
						amount: Number(tx.amount),
						currency: tx.currency,
						date: tx.date,
						category: tx.category,
						splitMode: tx.splitMode,
						isLocked: tx.isLocked,
						paidBy: {
							type: tx.paidByType,
							id: tx.paidById,
							name: paidByName,
							avatarUrl: paidByAvatar,
							isMe: tx.paidByType === participantType && tx.paidById === participantId,
						},
						status,
						canEdit: canModifyTx,
						canDelete: canModifyTx,
						hasUnseenChanges: tx.splitParticipants.find(
							(sp) => sp.participantType === participantType && sp.participantId === participantId,
						)?.hasUnseenChanges ?? false,
						splitParticipants: tx.splitParticipants.map((sp) => ({
							...sp,
							shareAmount: Number(sp.shareAmount),
						})),
					};
				}),
			);

			return {
				transactions: enriched,
				total,
				page: input.page,
				limit: input.limit,
			};
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			await requireProjectRole(ctx.db, input.id, "user", userId, "ORGANIZER");

			const project = await ctx.db.project.findUniqueOrThrow({
				where: { id: input.id },
				select: { createdById: true, name: true },
			});

			if (project.createdById !== userId) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only the project creator can delete a project",
				});
			}

			return runInProjectTransaction(ctx.db, userId, async (tx) => {
				await logAudit(tx, {
					actor: { participantType: "user", participantId: userId },
					action: "DELETED",
					targetType: "PROJECT",
					targetId: input.id,
					changes: { name: project.name },
					projectId: input.id,
				});

				await tx.project.delete({ where: { id: input.id } });
				return { success: true };
			});
		}),

	// ── Magic Links ───────────────────────────────────────────────────────────

	createMagicLink: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				roleGranted: projectRoleSchema.default("CONTRIBUTOR"),
				expiresAt: z.date().optional(),
				maxUses: z.number().int().positive().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (input.roleGranted === "ORGANIZER") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Magic links cannot grant the Organizer role",
				});
			}

			const userId = ctx.session.user.id;
			await requireProjectRole(
				ctx.db,
				input.projectId,
				"user",
				userId,
				"EDITOR",
			);

		// Return existing active link for this project + role if one exists
		const existing = await ctx.db.magicLink.findFirst({
			where: {
				projectId: input.projectId,
				roleGranted: input.roleGranted,
				isActive: true,
			},
		});
		if (existing) {
			return {
				...existing,
				url: `${env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:1997"}/projects/${input.projectId}?invite=${existing.id}`,
			};
		}

			return runInProjectTransaction(ctx.db, userId, async (tx) => {
				const magicLink = await tx.magicLink.create({
					data: {
						id: crypto.randomUUID(),
						projectId: input.projectId,
						roleGranted: input.roleGranted,
						createdById: userId,
						expiresAt: input.expiresAt ?? null,
						maxUses: input.maxUses ?? null,
					},
				});

				await logAudit(tx, {
					actor: { participantType: "user", participantId: userId },
					action: "CREATED",
					targetType: "PROJECT",
					targetId: input.projectId,
					changes: { linkId: magicLink.id, roleGranted: input.roleGranted },
					projectId: input.projectId,
				});

				return {
					...magicLink,
					url: `${env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:1997"}/projects/${input.projectId}?invite=${magicLink.id}`,
				};
			});
		}),

	listMagicLinks: protectedProcedure
		.input(z.object({ projectId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			await requireProjectRole(
				ctx.db,
				input.projectId,
				"user",
				userId,
				"EDITOR",
			);

			return ctx.db.magicLink.findMany({
				where: { projectId: input.projectId, isActive: true },
				orderBy: { createdAt: "desc" },
			});
		}),

	revokeMagicLink: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				linkId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			await requireProjectRole(
				ctx.db,
				input.projectId,
				"user",
				userId,
				"EDITOR",
			);

			const link = await ctx.db.magicLink.findUnique({
				where: { id: input.linkId },
				select: { id: true, projectId: true },
			});

			if (!link || link.projectId !== input.projectId) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Magic link not found",
				});
			}

			return runInProjectTransaction(ctx.db, userId, async (tx) => {
				const updated = await tx.magicLink.update({
					where: { id: input.linkId },
					data: { isActive: false },
				});

				await logAudit(tx, {
					actor: { participantType: "user", participantId: userId },
					action: "EDITED",
					targetType: "PROJECT",
					targetId: input.projectId,
					changes: { linkId: input.linkId, revoked: true },
					projectId: input.projectId,
				});

				return updated;
			});
		}),

	resetMagicLink: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				role: projectRoleSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (input.role === "ORGANIZER") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Magic links cannot grant the Organizer role",
				});
			}

			const userId = ctx.session.user.id;
			await requireProjectRole(
				ctx.db,
				input.projectId,
				"user",
				userId,
				"EDITOR",
			);

			return runInProjectTransaction(ctx.db, userId, async (tx) => {
				await tx.magicLink.updateMany({
					where: {
						projectId: input.projectId,
						roleGranted: input.role,
						isActive: true,
					},
					data: { isActive: false },
				});

				const magicLink = await tx.magicLink.create({
					data: {
						id: crypto.randomUUID(),
						projectId: input.projectId,
						roleGranted: input.role,
						createdById: userId,
					},
				});

				await logAudit(tx, {
					actor: { participantType: "user", participantId: userId },
					action: "CREATED",
					targetType: "PROJECT",
					targetId: input.projectId,
					changes: { linkId: magicLink.id, roleGranted: input.role, reset: true },
					projectId: input.projectId,
				});

				return {
					...magicLink,
					url: `${env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:1997"}/projects/${input.projectId}?invite=${magicLink.id}`,
				};
			});
		}),

	// ── Public (unauthenticated) access ──────────────────────────────────────

	/**
	 * Read-only project detail for PUBLIC projects.
	 * No auth required. Returns stripped-down data without settlement balances
	 * or participant debt details.
	 */
	publicDetail: publicProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const project = await ctx.db.project.findUnique({
				where: { id: input.id },
				include: {
					participants: true,
					billingPeriods: {
						where: { status: "OPEN" },
						take: 1,
						orderBy: { startDate: "desc" },
					},
				},
			});

			if (!project || project.visibility !== "PUBLIC") {
				return null;
			}

			const participants = await resolveParticipantNames(
				ctx.db,
				project.participants,
			);

			// Category stats
			const rawCategoryStats = await ctx.db.sharedTransaction.groupBy({
				by: ["categoryId"],
				where: { projectId: input.id },
				_sum: { amount: true },
				_count: { _all: true },
			});

			const totalSpent = rawCategoryStats.reduce(
				(sum, s) => sum + (s._sum.amount ? Number(s._sum.amount) : 0),
				0,
			);

			const categoryIds = rawCategoryStats
				.map((s) => s.categoryId)
				.filter((id): id is string => id !== null);
			const categories =
				categoryIds.length > 0
					? await ctx.db.category.findMany({
							where: { id: { in: categoryIds } },
							select: { id: true, name: true, color: true },
						})
					: [];
			const categoryMap = new Map(categories.map((c) => [c.id, c]));

			const categoryStats = rawCategoryStats.map((s) => {
				const cat = s.categoryId ? categoryMap.get(s.categoryId) : null;
				return {
					categoryId: s.categoryId,
					name: cat?.name ?? "Uncategorized",
					color: cat?.color ?? "gray",
					total: s._sum.amount ? Number(s._sum.amount) : 0,
					count: s._count._all,
				};
			});

			const currentBillingPeriod =
				project.type === "ONGOING"
					? (project.billingPeriods[0] ?? null)
					: null;

			return {
				id: project.id,
				name: project.name,
				description: project.description,
				type: project.type,
				status: project.status,
				imagePath: project.imagePath,
				budgetAmount: project.budgetAmount,
				budgetCurrency: project.budgetCurrency,
				primaryCurrency: project.primaryCurrency,
				startDate: project.startDate,
				endDate: project.endDate,
				visibility: project.visibility,
				createdAt: project.createdAt,
				participants,
				categoryStats,
				totalSpent,
				currentBillingPeriod,
			};
		}),

	/**
	 * Read-only expense list for PUBLIC projects.
	 * No auth required. canEdit and canDelete are always false.
	 */
	publicListExpenses: publicProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				page: z.number().int().positive().default(1),
				limit: z.number().int().positive().max(500).default(20),
			}),
		)
		.query(async ({ ctx, input }) => {
			const project = await ctx.db.project.findUnique({
				where: { id: input.projectId },
				select: { visibility: true },
			});

			if (!project || project.visibility !== "PUBLIC") {
				return null;
			}

			const where = { projectId: input.projectId };

			const [transactions, total] = await Promise.all([
				ctx.db.sharedTransaction.findMany({
					where,
					include: {
						category: {
							select: { id: true, name: true, color: true, icon: true },
						},
						splitParticipants: {
							select: {
								id: true,
								participantType: true,
								participantId: true,
								shareAmount: true,
							},
						},
					},
					orderBy: { date: "desc" },
					skip: (input.page - 1) * input.limit,
					take: input.limit,
				}),
				ctx.db.sharedTransaction.count({ where }),
			]);

			const enriched = await Promise.all(
				transactions.map(async (tx) => {
					let paidByName = "Unknown";
					let paidByAvatar: string | null = null;
					if (tx.paidByType === "user") {
						const u = await ctx.db.user.findUnique({
							where: { id: tx.paidById },
							select: { name: true, image: true, avatarPath: true },
						});
						paidByName = u?.name ?? "Unknown";
						paidByAvatar =
							getImageUrl(u?.avatarPath ?? null) ?? u?.image ?? null;
					} else if (tx.paidByType === "shadow") {
						const s = await ctx.db.shadowProfile.findUnique({
							where: { id: tx.paidById },
							select: { name: true },
						});
						paidByName = s?.name ?? "Unknown";
					} else {
						const g = await ctx.db.guestSession.findUnique({
							where: { id: tx.paidById },
							select: { name: true },
						});
						paidByName = g?.name ?? "Unknown";
					}

					return {
						id: tx.id,
						description: tx.description,
						amount: Number(tx.amount),
						currency: tx.currency,
						date: tx.date,
						category: tx.category,
						splitMode: tx.splitMode,
						isLocked: tx.isLocked,
						paidBy: {
							type: tx.paidByType,
							id: tx.paidById,
							name: paidByName,
							avatarUrl: paidByAvatar,
							isMe: false,
						},
						status: "active" as const,
						canEdit: false,
						canDelete: false,
						hasUnseenChanges: false,
						splitParticipants: tx.splitParticipants.map((sp) => ({
							...sp,
							shareAmount: Number(sp.shareAmount),
						})),
					};
				}),
			);

			return {
				transactions: enriched,
				total,
				page: input.page,
				limit: input.limit,
			};
		}),

	// ── Group Settlement ──────────────────────────────────────────────────────

	/**
	 * GET /api/project/settlementPlan
	 *
	 * Computes the optimal settlement plan for a project (or a specific billing
	 * period). Returns the minimum set of payments to bring all balances to zero,
	 * grouped by currency.
	 *
	 * Read-only: does not create any settlement records.
	 */
	settlementPlan: guestOrProtectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				periodId: z.string().optional(),
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

			const { transactions, settlements } =
				await fetchProjectTransactionsAndSettlements(
					ctx.db,
					input.projectId,
					input.periodId,
				);

			const result = computeSettlementPlan(transactions, settlements);

			return {
				byCurrency: result.byCurrency,
				participantCount: result.participantCount,
			};
		}),

	/**
	 * GET /api/project/participantBalances
	 *
	 * Returns the per-participant balance breakdown for a project (or billing
	 * period): how much each person paid, their fair share, and their net balance.
	 *
	 * Used by the project dashboard to show individual balance cards.
	 *
	 * Read-only: no side effects.
	 */
	participantBalances: guestOrProtectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				periodId: z.string().optional(),
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

			const { transactions, settlements } =
				await fetchProjectTransactionsAndSettlements(
					ctx.db,
					input.projectId,
					input.periodId,
				);

			const result = computeSettlementPlan(transactions, settlements);

			// Flatten balances across all currencies into a single list
			const allBalances = Object.entries(result.byCurrency).flatMap(
				([currency, breakdown]) =>
					breakdown.balances.map((b) => ({ ...b, currency })),
			);

			return {
				balances: allBalances,
				participantCount: result.participantCount,
			};
		}),
});

// ── shared data fetcher ───────────────────────────────────────────────────────

/**
 * Fetch transactions (with split participants) and FINALIZED settlements for
 * a project, optionally scoped to a billing period.
 *
 * Settlements are filtered to pairs where both participants appear in the
 * fetched transactions, so cross-project settlements don't bleed in.
 */
async function fetchProjectTransactionsAndSettlements(
	db: PrismaClient,
	projectId: string,
	periodId?: string,
) {
	const transactions = await db.sharedTransaction.findMany({
		where: {
			projectId,
			...(periodId ? { billingPeriodId: periodId } : {}),
		},
		select: {
			currency: true,
			amount: true,
			paidByType: true,
			paidById: true,
			splitParticipants: {
				select: {
					participantType: true,
					participantId: true,
					shareAmount: true,
				},
			},
		},
	});

	if (transactions.length === 0) {
		return { transactions: [], settlements: [] };
	}

	// Collect unique participant keys from these transactions
	type ParticipantPair = {
		participantType: ParticipantType;
		participantId: string;
	};
	const participantSet = new Map<string, ParticipantPair>();

	for (const tx of transactions) {
		const pk = `${tx.paidByType}:${tx.paidById}`;
		participantSet.set(pk, {
			participantType: tx.paidByType,
			participantId: tx.paidById,
		});
		for (const sp of tx.splitParticipants) {
			const spk = `${sp.participantType}:${sp.participantId}`;
			participantSet.set(spk, {
				participantType: sp.participantType,
				participantId: sp.participantId,
			});
		}
	}

	const participants = [...participantSet.values()];

	if (participants.length < 2) {
		return { transactions, settlements: [] };
	}

	// Fetch FINALIZED settlements where both parties are project participants
	const settlements = await db.settlement.findMany({
		where: {
			status: "FINALIZED",
			AND: [
				{
					OR: participants.map((p) => ({
						fromParticipantType: p.participantType,
						fromParticipantId: p.participantId,
					})),
				},
				{
					OR: participants.map((p) => ({
						toParticipantType: p.participantType,
						toParticipantId: p.participantId,
					})),
				},
			],
		},
		select: {
			fromParticipantType: true,
			fromParticipantId: true,
			toParticipantType: true,
			toParticipantId: true,
			amount: true,
			currency: true,
		},
	});

	return { transactions, settlements };
}
