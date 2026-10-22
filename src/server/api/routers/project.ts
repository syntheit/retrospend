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
import { BALANCE_SETTLEMENT_STATUSES } from "~/server/services/shared-expenses/balance";
import { computePeriodLabel } from "~/server/api/routers/billingPeriod";
import { computeTransactionStatus } from "~/server/services/shared-expenses/verification.service";
import {
	computeSettlementPlan,
	isFullySettled,
} from "~/server/services/shared-expenses/group-settlement";
import { requireProjectRole } from "~/server/services/shared-expenses/project-permissions";
import { getBalancesFromPerspective } from "~/server/services/shared-expenses/balances-perspective.service";
import { resolveVerification } from "~/server/services/shared-expenses/auto-accept";
import {
	canonicalizeProjectLedger,
	resolveClaimAliases,
} from "~/server/services/shared-expenses/identity";
import {
	type ParticipantRef,
	sameParticipant,
} from "~/server/services/shared-expenses/types";
import {
	buildContactVisibility,
	redactContact,
} from "~/server/services/shared-expenses/contact-visibility";
import type { ParticipantType, Prisma, PrismaClient } from "~prisma";
import {
	resolveSplits,
	type SplitParticipantRef,
} from "~/lib/shared-split-computation";

import {
	projectBalancesFromPerspective,
	projectParticipantBalances,
	projectSettlementPlan,
} from "~/server/services/project/group.service";

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
					select: {
						id: true,
						name: true,
						username: true,
						image: true,
						avatarPath: true,
					},
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
				return {
					...p,
					name: "Deleted User",
					email: null,
					username: null,
					avatarUrl: null,
				};
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

/**
 * Applies the shared contact-visibility rule (see contact-visibility.ts) to a
 * list of resolved participants. `viewer` is null for viewer links.
 */
async function redactParticipantEmails<
	T extends {
		participantType: string;
		participantId: string;
		email: string | null;
	},
>(db: PrismaClient, viewer: ParticipantRef | null, items: T[]): Promise<T[]> {
	const visible = await buildContactVisibility(db, viewer, items);
	return items.map((item) => redactContact(item, visible));
}

/**
 * Batch-resolve names + avatars for a set of (participantType, participantId) pairs.
 * Returns a Map keyed by "type:id" → { name, avatarUrl }.
 */
async function batchResolveIdentities(
	db: PrismaClient,
	entries: Array<{ participantType: string; participantId: string }>,
): Promise<Map<string, { name: string; avatarUrl: string | null }>> {
	const userIds = new Set<string>();
	const shadowIds = new Set<string>();
	const guestIds = new Set<string>();

	for (const e of entries) {
		if (e.participantType === "user" && e.participantId !== "DELETED_USER") {
			userIds.add(e.participantId);
		} else if (e.participantType === "shadow") {
			shadowIds.add(e.participantId);
		} else if (e.participantType === "guest") {
			guestIds.add(e.participantId);
		}
	}

	const [users, shadows, guests] = await Promise.all([
		userIds.size > 0
			? db.user.findMany({
					where: { id: { in: [...userIds] } },
					select: { id: true, name: true, image: true, avatarPath: true },
				})
			: [],
		shadowIds.size > 0
			? db.shadowProfile.findMany({
					where: { id: { in: [...shadowIds] } },
					select: { id: true, name: true },
				})
			: [],
		guestIds.size > 0
			? db.guestSession.findMany({
					where: { id: { in: [...guestIds] } },
					select: { id: true, name: true },
				})
			: [],
	]);

	const result = new Map<string, { name: string; avatarUrl: string | null }>();

	for (const u of users) {
		result.set(`user:${u.id}`, {
			name: u.name ?? "Unknown",
			avatarUrl: getImageUrl(u.avatarPath ?? null) ?? u.image ?? null,
		});
	}
	for (const s of shadows) {
		result.set(`shadow:${s.id}`, {
			name: s.name ?? "Unknown",
			avatarUrl: null,
		});
	}
	for (const g of guests) {
		result.set(`guest:${g.id}`, { name: g.name ?? "Unknown", avatarUrl: null });
	}

	// Handle deleted users
	result.set("user:DELETED_USER", { name: "Deleted User", avatarUrl: null });

	return result;
}

/**
 * Granting ORGANIZER (Owner) requires the caller to be an ORGANIZER. Editors
 * may grant EDITOR and below. Mirrors magic links, which refuse ORGANIZER.
 */
function assertCanGrantRole(callerRole: string, grantedRole: string): void {
	if (grantedRole === "ORGANIZER" && callerRole !== "ORGANIZER") {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Only an Owner can make someone an Owner",
		});
	}
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

const projectRoleSchema = z.enum([
	"ORGANIZER",
	"EDITOR",
	"CONTRIBUTOR",
	"VIEWER",
]);

const memberSchema = z.object({
	projectId: z.string().min(1),
	participantType: z.enum(["user", "guest", "shadow"]),
	participantId: z.string().min(1),
});

const cycleLengthSchema = z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "CUSTOM"]);
const closePermissionSchema = z.enum(["ORGANIZER_ONLY", "ANY_PARTICIPANT"]);

const createProjectSchema = z.object({
	name: z.string().min(1).max(191),
	description: z.string().max(500).optional(),
	budgetAmount: z.number().positive().optional(),
	budgetCurrency: z.string().min(1).max(10).optional(),
	primaryCurrency: z.string().min(1).max(10).default("USD"),
	visibility: z.enum(["PRIVATE", "PUBLIC"]).default("PRIVATE"),
	billingCycleLength: cycleLengthSchema.optional(),
	billingCycleDays: z.number().int().positive().optional(),
	billingAutoClose: z.boolean().default(false),
	billingCloseReminderDays: z.number().int().min(0).default(3),
	billingClosePermission: closePermissionSchema.default("ORGANIZER_ONLY"),
});

const updateProjectSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1).max(191).optional(),
	description: z.string().max(500).nullish(),
	budgetAmount: z.number().positive().nullish(),
	budgetCurrency: z.string().min(1).max(10).nullish(),
	primaryCurrency: z.string().min(1).max(10).optional(),
	status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
	visibility: z.enum(["PRIVATE", "PUBLIC"]).optional(),
	billingCycleLength: cycleLengthSchema.nullish(),
	billingCycleDays: z.number().int().positive().nullish(),
	billingAutoClose: z.boolean().optional(),
	billingCloseReminderDays: z.number().int().min(0).optional(),
	billingClosePermission: closePermissionSchema.optional(),
	autoAcceptSplits: z.boolean().optional(),
});

const pageSchema = {
	page: z.number().int().positive().default(1),
	limit: z.number().int().positive().max(500).default(20),
};

const groupInput = z.object({
	projectId: z.string().min(1),
	periodId: z.string().optional(),
});

/** The signed-in user's role in the project, or FORBIDDEN / NOT_FOUND. */
function roleOf(
	ctx: {
		db: Parameters<typeof requireProjectRole>[0];
		session: { user: { id: string } };
	},
	projectId: string,
	minimum: "VIEWER" | "CONTRIBUTOR" | "EDITOR" | "ORGANIZER",
) {
	return requireProjectRole(
		ctx.db,
		projectId,
		"user",
		ctx.session.user.id,
		minimum,
	);
}

/** Scope check and membership check for any reader: user, guest or viewer link. */
async function assertReader(
	ctx: {
		db: Parameters<typeof requireProjectRole>[0];
		participant: Parameters<typeof assertGuestProjectScope>[0];
	},
	projectId: string,
) {
	assertGuestProjectScope(ctx.participant, projectId);
	const { participantType, participantId } = ctx.participant;
	return requireProjectRole(
		ctx.db,
		projectId,
		participantType,
		participantId,
		"VIEWER",
	);
}

const actor = (ctx: { session: { user: { id: string } } }) => ({
	userId: ctx.session.user.id,
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
							description: input.description ?? null,
							budgetAmount: input.budgetAmount ?? null,
							budgetCurrency: input.budgetCurrency ?? null,
							primaryCurrency: input.primaryCurrency,
							createdById: userId,
							visibility: input.visibility,
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

					// Auto-create first billing period for projects with a cycle
					if (input.billingCycleLength) {
						const periodStart = new Date();
						const periodEnd = computeBillingPeriodEnd(
							periodStart,
							input.billingCycleLength,
							input.billingCycleDays,
						);
						const label = computePeriodLabel(
							periodStart,
							periodEnd,
							input.billingCycleLength,
						);
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
						changes: { name: input.name },
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
				status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
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
			// Ghost/guest emails only for those allowed to see them (shared rule).
			const contactVisible = await buildContactVisibility(
				ctx.db,
				{ participantType: "user", participantId: userId },
				resolvedAll,
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
			const spentGroupBy =
				projectIds.length > 0
					? await ctx.db.sharedTransaction.groupBy({
							by: ["projectId"],
							where: { projectId: { in: projectIds } },
							_sum: { amount: true },
						})
					: [];
			const spentMap = new Map(
				spentGroupBy.map((g) => [g.projectId, Number(g._sum.amount ?? 0)]),
			);

			// Compute isSettled for multi-participant projects with transactions
			// Batched: 2 queries total instead of 2 per project
			const multiParticipantWithTxIds = projects
				.filter(
					(p) => p._count.participants > 1 && p._count.sharedTransactions > 0,
				)
				.map((p) => p.id);

			const settlementResults = new Map<string, boolean>();
			if (multiParticipantWithTxIds.length > 0) {
				// 1. Batch fetch all transactions for qualifying projects
				const allTxns = await ctx.db.sharedTransaction.findMany({
					where: { projectId: { in: multiParticipantWithTxIds } },
					select: {
						projectId: true,
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

				// Group transactions by project (projectId is non-null since we filtered by it)
				const txsByProject = new Map<string, typeof allTxns>();
				for (const tx of allTxns) {
					const pid = tx.projectId!;
					let list = txsByProject.get(pid);
					if (!list) {
						list = [];
						txsByProject.set(pid, list);
					}
					list.push(tx);
				}

				// 2. Batch fetch this batch of projects' counted settlements,
				// scoped by projectId (settlements are project-scoped now), and group
				// them by project.
				const allSettlements = await ctx.db.settlement.findMany({
					where: {
						projectId: { in: multiParticipantWithTxIds },
						status: { in: [...BALANCE_SETTLEMENT_STATUSES] },
					},
					select: {
						projectId: true,
						fromParticipantType: true,
						fromParticipantId: true,
						toParticipantType: true,
						toParticipantId: true,
						amount: true,
						currency: true,
					},
				});
				const settlementsByProject = new Map<string, typeof allSettlements>();
				for (const s of allSettlements) {
					const pid = s.projectId!;
					let list = settlementsByProject.get(pid);
					if (!list) {
						list = [];
						settlementsByProject.set(pid, list);
					}
					list.push(s);
				}

				// 3. Compute settlement plan per project.
				for (const pid of multiParticipantWithTxIds) {
					const projectTxns = txsByProject.get(pid) ?? [];
					if (projectTxns.length === 0) continue;

					const projectSettlements = settlementsByProject.get(pid) ?? [];

					const plan = computeSettlementPlan(projectTxns, projectSettlements);
					settlementResults.set(pid, isFullySettled(plan));
				}
			}

			const enriched = projects.map((p) => {
				const participantDetails = participantsByProject.get(p.id) ?? [];
				const myParticipant = participantDetails.find(
					(pp) => pp.participantType === "user" && pp.participantId === userId,
				);

				// Find the raw participant record to get excludeFromAnalytics
				const rawMyParticipant = p.participants.find(
					(pp) => pp.participantType === "user" && pp.participantId === userId,
				);

				const myRole = myParticipant?.role ?? null;

				return {
					...p,
					participants: participantDetails.map((pp) =>
						redactContact(pp, contactVisible),
					),
					myRole,
					excludeFromAnalytics: rawMyParticipant?.excludeFromAnalytics ?? false,
					totalSpent: spentMap.get(p.id) ?? 0,
					currentBillingPeriod: p.billingPeriods[0] ?? null,
					isSettled: settlementResults.get(p.id) ?? false,
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
			const resolvedParticipants = await resolveParticipantNames(
				ctx.db,
				project.participants,
			);

			// Determine current participant's role
			const myParticipant =
				participantType === "viewerLink"
					? null
					: resolvedParticipants.find(
							(pp) =>
								pp.participantType === participantType &&
								pp.participantId === participantId,
						);
			const myRole =
				participantType === "viewerLink"
					? ("VIEWER" as const)
					: (myParticipant?.role ?? null);

			// Ghost/guest emails only for their creator, the guest themself, or
			// editors/organizers (shared rule). Viewer links see none.
			const participants = await redactParticipantEmails(
				ctx.db,
				participantType === "viewerLink"
					? null
					: { participantType, participantId },
				resolvedParticipants,
			);

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

			const currentBillingPeriod = project.billingCycleLength
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
				status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
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
				autoAcceptSplits: z.boolean().optional(),
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
			trackField("status", fields.status);
			trackField("visibility", fields.visibility);
			trackField("billingCycleLength", fields.billingCycleLength);
			trackField("billingCycleDays", fields.billingCycleDays);
			trackField("billingAutoClose", fields.billingAutoClose);
			trackField("billingCloseReminderDays", fields.billingCloseReminderDays);
			trackField("billingClosePermission", fields.billingClosePermission);
			trackField("autoAcceptSplits", fields.autoAcceptSplits);

			if (Object.keys(diff).length === 0) {
				return existing;
			}

			// Turning billing periods ON (from off): open a first period so the
			// project has a current cycle, mirroring project creation. Only when
			// none is already open, so re-enabling reuses a leftover open period.
			const enablingBilling =
				existing.billingCycleLength == null &&
				fields.billingCycleLength != null;

			return runInProjectTransaction(ctx.db, userId, async (tx) => {
				const updated = await tx.project.update({
					where: { id },
					data: updateData as Prisma.ProjectUncheckedUpdateInput,
				});

				if (enablingBilling && fields.billingCycleLength) {
					const openPeriod = await tx.billingPeriod.findFirst({
						where: { projectId: id, status: "OPEN" },
						select: { id: true },
					});
					if (!openPeriod) {
						const periodStart = new Date();
						const periodEnd = computeBillingPeriodEnd(
							periodStart,
							fields.billingCycleLength,
							fields.billingCycleDays ?? undefined,
						);
						await tx.billingPeriod.create({
							data: {
								projectId: id,
								label: computePeriodLabel(
									periodStart,
									periodEnd,
									fields.billingCycleLength,
								),
								startDate: periodStart,
								endDate: periodEnd,
								status: "OPEN",
							},
						});
					}
				}

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

			const callerParticipant = await requireProjectRole(
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

			// Shadows can't log in, so they must never hold an elevated (EDITOR/
			// ORGANIZER) role — otherwise claiming the shadow could grant that role
			// to whoever claims it. Cap the shadow's participant-row role at
			// CONTRIBUTOR. (The magic-link role is downgraded separately below.)
			const effectiveRole =
				input.participantType === "shadow" &&
				(input.role === "ORGANIZER" || input.role === "EDITOR")
					? "CONTRIBUTOR"
					: input.role;

			// Only an Owner can make someone else an Owner. Editors can add people
			// at their own level or below.
			assertCanGrantRole(callerParticipant.role, effectiveRole);

			const participant = await runInProjectTransaction(
				ctx.db,
				userId,
				async (tx) => {
					const p = await tx.projectParticipant.create({
						data: {
							projectId: input.projectId,
							participantType: input.participantType,
							participantId: input.participantId,
							role: effectiveRole,
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
							role: effectiveRole,
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

					// Create a single-use magic link so the recipient can join directly.
					// It grants the same (capped) role as the shadow's participant row,
					// so joining through it can never outrank the row it stands for.
					const magicLinkRole = effectiveRole;
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
						joinUrl = appUrl
							? `${appUrl}/projects/${input.projectId}?invite=${magicLink.id}`
							: undefined;
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
						console.error(
							"[Notification Error] shadow PARTICIPANT_ADDED email:",
							err,
						),
					);
				}
			}

			return participant;
		}),

	/**
	 * Lists past expenses in a project that a newly-added participant could be
	 * folded into. Used to power the "Include {name} in existing expenses?"
	 * chooser. Excludes locked (settled) expenses, expenses the participant is
	 * already part of, and flags non-EQUAL expenses as ineligible for automatic
	 * rebalancing (their amounts can't be recomputed without user input).
	 */
	rebalanceableExpenses: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				participantType: z.enum(["user", "guest", "shadow"]),
				participantId: z.string().min(1),
			}),
		)
		.query(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			await requireProjectRole(
				ctx.db,
				input.projectId,
				"user",
				userId,
				"EDITOR",
			);

			const [expenses, members] = await Promise.all([
				ctx.db.sharedTransaction.findMany({
					where: { projectId: input.projectId },
					select: {
						id: true,
						description: true,
						amount: true,
						currency: true,
						date: true,
						splitMode: true,
						isLocked: true,
						splitParticipants: {
							select: { participantType: true, participantId: true },
						},
					},
					orderBy: { date: "desc" },
				}),
				ctx.db.projectParticipant.findMany({
					where: { projectId: input.projectId },
					select: { participantType: true, participantId: true },
				}),
			]);

			// Resolve claim aliases so a claimed shadow and its claiming user count
			// as the SAME party — matching how rebalanceExpenses decides "already
			// included". Cover every member ref plus every split participant so the
			// canonical map is complete.
			const { canonicalKey } = await resolveClaimAliases(ctx.db, [
				{
					participantType: input.participantType,
					participantId: input.participantId,
				},
				...members.map((m) => ({
					participantType: m.participantType,
					participantId: m.participantId,
				})),
				...expenses.flatMap((e) =>
					e.splitParticipants.map((sp) => ({
						participantType: sp.participantType,
						participantId: sp.participantId,
					})),
				),
			]);

			const newcomerCanonical = canonicalKey({
				participantType: input.participantType,
				participantId: input.participantId,
			});

			// Every current member EXCEPT the newly-added person, canonicalized and
			// de-duplicated. An expense is a genuine "split with everyone" only if it
			// already contains all of these.
			const otherMemberCanonicals = new Set(
				members
					.map((m) =>
						canonicalKey({
							participantType: m.participantType,
							participantId: m.participantId,
						}),
					)
					.filter((k) => k !== newcomerCanonical),
			);

			return expenses
				.filter((e) => !e.isLocked)
				.filter(
					(e) =>
						!e.splitParticipants.some(
							(sp) =>
								canonicalKey({
									participantType: sp.participantType,
									participantId: sp.participantId,
								}) === newcomerCanonical,
						),
				)
				.map((e) => {
					const splitCanonicals = new Set(
						e.splitParticipants.map((sp) =>
							canonicalKey({
								participantType: sp.participantType,
								participantId: sp.participantId,
							}),
						),
					);
					// True only when every OTHER current member is already a split
					// participant — i.e. this expense was genuinely "split with
					// everyone" and the newcomer should be folded in by default.
					const hasAllOtherMembers = [...otherMemberCanonicals].every((k) =>
						splitCanonicals.has(k),
					);
					return {
						id: e.id,
						description: e.description,
						amount: Number(e.amount),
						currency: e.currency,
						date: e.date,
						splitMode: e.splitMode,
						// Only EQUAL-mode expenses can be recomputed automatically.
						eligible: e.splitMode === "EQUAL",
						currentParticipantCount: e.splitParticipants.length,
						hasAllOtherMembers,
					};
				});
		}),

	/**
	 * Folds a participant into a chosen set of existing project expenses.
	 *
	 * Only EQUAL-mode expenses are recomputed (their equal division is re-derived
	 * including the new participant). EXACT / PERCENTAGE / SHARES expenses are
	 * NEVER silently altered — they are skipped and reported back, because their
	 * amounts encode explicit user intent that can't be inferred. Locked (settled)
	 * expenses are always skipped.
	 *
	 * The participant must already be a member of the project. New split rows are
	 * created as PENDING so the added person can verify their inclusion, and all
	 * other participants are flagged with unseen changes — matching an edit.
	 */
	rebalanceExpenses: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				participantType: z.enum(["user", "guest", "shadow"]),
				participantId: z.string().min(1),
				// Omit to target every eligible (EQUAL, unlocked) expense.
				expenseIds: z.array(z.string().min(1)).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const actor = { participantType: "user" as const, participantId: userId };

			await requireProjectRole(
				ctx.db,
				input.projectId,
				"user",
				userId,
				"EDITOR",
			);

			// The participant being folded in must already belong to the project.
			const membership = await ctx.db.projectParticipant.findUnique({
				where: {
					projectId_participantType_participantId: {
						projectId: input.projectId,
						participantType: input.participantType,
						participantId: input.participantId,
					},
				},
				select: { id: true },
			});
			if (!membership) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "That person is not a member of this project",
				});
			}

			const idFilter =
				input.expenseIds && input.expenseIds.length > 0
					? { id: { in: input.expenseIds } }
					: {};

			const candidates = await ctx.db.sharedTransaction.findMany({
				where: { projectId: input.projectId, ...idFilter },
				select: {
					id: true,
					amount: true,
					currency: true,
					splitMode: true,
					isLocked: true,
					paidByType: true,
					paidById: true,
					splitParticipants: {
						select: { participantType: true, participantId: true },
					},
				},
			});

			let rebalancedCount = 0;
			const skipped: Array<{ id: string; reason: string }> = [];
			const rebalancedIds: string[] = [];

			// Resolve claim aliases so a claimed shadow and its claiming user count as
			// the SAME party when deciding "already included". Otherwise adding
			// `user:U` to an expense that already lists `shadow:S` (U claimed S) would
			// create a duplicate participant and double-count the balance.
			const { canonicalKey } = await resolveClaimAliases(ctx.db, [
				{
					participantType: input.participantType,
					participantId: input.participantId,
				},
				...candidates.flatMap((e) =>
					e.splitParticipants.map((sp) => ({
						participantType: sp.participantType,
						participantId: sp.participantId,
					})),
				),
			]);
			const inputCanonical = canonicalKey({
				participantType: input.participantType,
				participantId: input.participantId,
			});

			for (const e of candidates) {
				if (e.isLocked) {
					skipped.push({ id: e.id, reason: "locked" });
					continue;
				}
				const alreadyIn = e.splitParticipants.some(
					(sp) =>
						canonicalKey({
							participantType: sp.participantType,
							participantId: sp.participantId,
						}) === inputCanonical,
				);
				if (alreadyIn) {
					skipped.push({ id: e.id, reason: "already_included" });
					continue;
				}
				if (e.splitMode !== "EQUAL") {
					// EXACT / PERCENTAGE / SHARES: never silently alter amounts.
					skipped.push({ id: e.id, reason: "non_equal_split" });
					continue;
				}
				rebalancedIds.push(e.id);
			}

			if (rebalancedIds.length === 0) {
				return { rebalancedCount: 0, skipped };
			}

			await runInProjectTransaction(ctx.db, userId, async (tx) => {
				// Auto-accept is decided by the PROJECT these expenses belong to.
				// Resolve the flag once and apply it to every re-split row.
				const rebalanceProject = await tx.project.findUnique({
					where: { id: input.projectId },
					select: { autoAcceptSplits: true },
				});
				const projectAutoAccept = rebalanceProject?.autoAcceptSplits ?? true;

				for (const e of candidates) {
					if (!rebalancedIds.includes(e.id)) continue;

					const newParticipants = [
						...e.splitParticipants.map((sp) => ({
							participantType: sp.participantType,
							participantId: sp.participantId,
						})),
						{
							participantType: input.participantType,
							participantId: input.participantId,
						},
					];

					// Same split code as create, in the expense's own currency
					// units, so the result matches a fresh EQUAL split.
					const shares = resolveSplits({
						mode: "EQUAL",
						amount: Number(e.amount),
						currency: e.currency,
						participants: newParticipants as SplitParticipantRef[],
						paidBy: {
							participantType: e.paidByType,
							participantId: e.paidById,
						},
					});

					// Replace all split rows with the recomputed shares. Everyone's
					// share changed, so re-resolve verification per row: the actor
					// stays ACCEPTED, and when the project auto-accepts, user
					// participants (existing or newcomer) return to AUTO_ACCEPTED;
					// otherwise everyone else is PENDING for manual approval.
					await tx.splitParticipant.deleteMany({
						where: { transactionId: e.id },
					});
					await tx.splitParticipant.createMany({
						data: shares.map((p) => {
							const ref = {
								participantType: p.participantType as ParticipantType,
								participantId: p.participantId,
							};
							const isActor = sameParticipant(ref, actor);
							const { status, verifiedAt } = resolveVerification(
								ref,
								actor,
								projectAutoAccept,
							);
							return {
								transactionId: e.id,
								participantType: ref.participantType,
								participantId: p.participantId,
								shareAmount: p.shareAmount,
								verificationStatus: status,
								verifiedAt,
								hasUnseenChanges: !isActor,
							};
						}),
					});

					await logAudit(tx, {
						actor,
						action: "EDITED",
						targetType: "SHARED_TRANSACTION",
						targetId: e.id,
						changes: {
							rebalanced: {
								addedParticipant: {
									participantType: input.participantType,
									participantId: input.participantId,
								},
							},
						},
						projectId: input.projectId,
					});

					rebalancedCount += 1;
				}
			});

			return { rebalancedCount, skipped, rebalancedIds };
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
			if (
				callerParticipant.role !== "ORGANIZER" &&
				target.role === "ORGANIZER"
			) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only an Owner can change another Owner's role",
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
					message: "The project creator cannot be demoted below Owner",
				});
			}

			const oldRole = target.role;

			// Shadows can't log in or act; never let one hold ORGANIZER/EDITOR — a
			// later claim or guest-merge would otherwise inherit the elevated role.
			const effectiveRole =
				input.participantType === "shadow" &&
				(input.role === "ORGANIZER" || input.role === "EDITOR")
					? "CONTRIBUTOR"
					: input.role;

			// Only an Owner can promote someone to Owner.
			assertCanGrantRole(callerParticipant.role, effectiveRole);

			return runInProjectTransaction(ctx.db, userId, async (tx) => {
				const updated = await tx.projectParticipant.update({
					where: { id: target.id },
					data: { role: effectiveRole },
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
						newRole: effectiveRole,
					},
					projectId: input.projectId,
				});

				return updated;
			});
		}),

	transferOwnership: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				newOwnerParticipantId: z.string().min(1),
				confirmProjectName: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			// Only the current owner (ORGANIZER) can transfer
			await requireProjectRole(
				ctx.db,
				input.projectId,
				"user",
				userId,
				"ORGANIZER",
			);

			const project = await ctx.db.project.findUniqueOrThrow({
				where: { id: input.projectId },
				select: { name: true, createdById: true },
			});

			// Must be the project creator (owner) to transfer
			if (project.createdById !== userId) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only the project owner can transfer ownership",
				});
			}

			// Confirm project name to prevent accidental transfers
			if (input.confirmProjectName !== project.name) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Project name does not match",
				});
			}

			// Target must be an existing user participant (not guest/shadow)
			const target = await ctx.db.projectParticipant.findUnique({
				where: {
					projectId_participantType_participantId: {
						projectId: input.projectId,
						participantType: "user",
						participantId: input.newOwnerParticipantId,
					},
				},
			});

			if (!target) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Target user is not a participant in this project",
				});
			}

			if (target.participantId === userId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "You are already the owner",
				});
			}

			return runInProjectTransaction(ctx.db, userId, async (tx) => {
				// Promote new owner to ORGANIZER
				await tx.projectParticipant.update({
					where: { id: target.id },
					data: { role: "ORGANIZER" },
				});

				// Demote old owner to EDITOR
				await tx.projectParticipant.updateMany({
					where: {
						projectId: input.projectId,
						participantType: "user",
						participantId: userId,
					},
					data: { role: "EDITOR" },
				});

				// Transfer createdById to the new owner
				await tx.project.update({
					where: { id: input.projectId },
					data: { createdById: input.newOwnerParticipantId },
				});

				await logAudit(tx, {
					actor: { participantType: "user", participantId: userId },
					action: "ROLE_CHANGED",
					targetType: "PROJECT",
					targetId: input.projectId,
					changes: {
						message: "Ownership transferred",
						previousOwner: userId,
						newOwner: input.newOwnerParticipantId,
					},
					projectId: input.projectId,
				});

				return { success: true };
			}).then(async (result) => {
				// Notify the new owner (fire-and-forget, outside transaction)
				const callerName = await resolveParticipantName("user", userId);
				void createNotification({
					userId: input.newOwnerParticipantId,
					type: "PARTICIPANT_ADDED",
					title: "Ownership transferred",
					body: `${callerName} transferred ownership of "${project.name}" to you.`,
					data: { projectId: input.projectId },
				});
				return result;
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
			if (
				callerParticipant.role !== "ORGANIZER" &&
				target.role === "ORGANIZER"
			) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only an Owner can remove another Owner",
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
						category: {
							select: { id: true, name: true, color: true, icon: true },
						},
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

			// Batch-resolve all participant identities (payers + split participants)
			const allParticipantEntries: Array<{
				participantType: string;
				participantId: string;
			}> = [];
			for (const tx of transactions) {
				allParticipantEntries.push({
					participantType: tx.paidByType,
					participantId: tx.paidById,
				});
				for (const sp of tx.splitParticipants) {
					allParticipantEntries.push({
						participantType: sp.participantType,
						participantId: sp.participantId,
					});
				}
			}
			const identityMap = await batchResolveIdentities(
				ctx.db,
				allParticipantEntries,
			);

			const enriched = transactions.map((tx) => {
				const payerIdentity = identityMap.get(
					`${tx.paidByType}:${tx.paidById}`,
				);

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
						name: payerIdentity?.name ?? "Unknown",
						avatarUrl: payerIdentity?.avatarUrl ?? null,
						isMe:
							tx.paidByType === participantType &&
							tx.paidById === participantId,
					},
					status,
					canEdit: canModifyTx,
					canDelete: canModifyTx,
					hasUnseenChanges:
						tx.splitParticipants.find(
							(sp) =>
								sp.participantType === participantType &&
								sp.participantId === participantId,
						)?.hasUnseenChanges ?? false,
					splitParticipants: tx.splitParticipants.map((sp) => {
						const identity = identityMap.get(
							`${sp.participantType}:${sp.participantId}`,
						);
						return {
							...sp,
							shareAmount: Number(sp.shareAmount),
							name: identity?.name ?? "Unknown",
							avatarUrl: identity?.avatarUrl ?? null,
						};
					}),
				};
			});

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
					message: "Magic links cannot grant the Owner role",
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
					message: "Magic links cannot grant the Owner role",
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
					changes: {
						linkId: magicLink.id,
						roleGranted: input.role,
						reset: true,
					},
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

			// Anyone on the internet can read this: return only what the public
			// page displays. No emails, no per-member preferences.
			const participants = (
				await resolveParticipantNames(ctx.db, project.participants)
			).map((p) => ({
				id: p.id,
				participantType: p.participantType,
				participantId: p.participantId,
				role: p.role,
				joinedAt: p.joinedAt,
				name: p.name,
				username: p.username,
				avatarUrl: p.avatarUrl,
			}));

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

			const currentBillingPeriod = project.billingCycleLength
				? (project.billingPeriods[0] ?? null)
				: null;

			return {
				id: project.id,
				name: project.name,
				description: project.description,
				status: project.status,
				imagePath: project.imagePath,
				budgetAmount: project.budgetAmount,
				budgetCurrency: project.budgetCurrency,
				primaryCurrency: project.primaryCurrency,
				visibility: project.visibility,
				autoAcceptSplits: project.autoAcceptSplits,
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

			// Batch-resolve all participant identities
			const allEntries: Array<{
				participantType: string;
				participantId: string;
			}> = [];
			for (const tx of transactions) {
				allEntries.push({
					participantType: tx.paidByType,
					participantId: tx.paidById,
				});
				for (const sp of tx.splitParticipants) {
					allEntries.push({
						participantType: sp.participantType,
						participantId: sp.participantId,
					});
				}
			}
			const identityMap = await batchResolveIdentities(ctx.db, allEntries);

			const enriched = transactions.map((tx) => {
				const payerIdentity = identityMap.get(
					`${tx.paidByType}:${tx.paidById}`,
				);

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
						name: payerIdentity?.name ?? "Unknown",
						avatarUrl: payerIdentity?.avatarUrl ?? null,
						isMe: false,
					},
					status: "active" as const,
					canEdit: false,
					canDelete: false,
					hasUnseenChanges: false,
					splitParticipants: tx.splitParticipants.map((sp) => {
						const identity = identityMap.get(
							`${sp.participantType}:${sp.participantId}`,
						);
						return {
							...sp,
							shareAmount: Number(sp.shareAmount),
							name: identity?.name ?? "Unknown",
							avatarUrl: identity?.avatarUrl ?? null,
						};
					}),
				};
			});

			return {
				transactions: enriched,
				total,
				page: input.page,
				limit: input.limit,
			};
		}),

	// ── Group Settlement ──────────────────────────────────────────────────────

	/** The fewest payments that settle the project (or one billing period), per currency. */
	settlementPlan: guestOrProtectedProcedure
		.input(groupInput)
		.query(async ({ ctx, input }) => {
			await assertReader(ctx, input.projectId);
			return projectSettlementPlan(ctx.db, input.projectId, input.periodId);
		}),

	/** Each person's paid, fair share and net balance, one row per currency. */
	participantBalances: guestOrProtectedProcedure
		.input(groupInput)
		.query(async ({ ctx, input }) => {
			await assertReader(ctx, input.projectId);
			return projectParticipantBalances(
				ctx.db,
				input.projectId,
				input.periodId,
			);
		}),

	/**
	 * Raw pairwise balances from one person's side (not the routed plan). Any
	 * member may read it: the whole project's balances are already visible to
	 * members, so one person's view leaks nothing new.
	 */
	balancesFromPerspective: guestOrProtectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				perspective: z.object({
					participantType: z.enum(["user", "guest", "shadow"]),
					participantId: z.string().min(1),
				}),
			}),
		)
		.query(async ({ ctx, input }) => {
			await assertReader(ctx, input.projectId);
			return projectBalancesFromPerspective(
				ctx.db,
				input.projectId,
				input.perspective,
				ctx.participant,
			);
		}),
});
