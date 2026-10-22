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
	listProjectExpenses,
	listPublicProjectExpenses,
} from "~/server/services/project/expenses.service";
import {
	projectBalancesFromPerspective,
	projectParticipantBalances,
	projectSettlementPlan,
} from "~/server/services/project/group.service";
import {
	getProjectDetail,
	getPublicProjectDetail,
	listProjects,
} from "~/server/services/project/project-read.service";

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
		.input(z.object({ status: z.enum(["ACTIVE", "ARCHIVED"]).optional() }))
		.query(({ ctx, input }) =>
			listProjects(ctx.db, ctx.session.user.id, input.status),
		),

	detail: guestOrProtectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			await assertReader(ctx, input.id);
			return getProjectDetail(ctx.db, input.id, ctx.participant);
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
				...pageSchema,
			}),
		)
		.query(async ({ ctx, input }) => {
			const caller = await assertReader(ctx, input.projectId);
			return listProjectExpenses(ctx.db, input, ctx.participant, caller.role);
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

	publicDetail: publicProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(({ ctx, input }) => getPublicProjectDetail(ctx.db, input.id)),

	publicListExpenses: publicProcedure
		.input(z.object({ projectId: z.string().min(1), ...pageSchema }))
		.query(({ ctx, input }) => listPublicProjectExpenses(ctx.db, input)),

	// ── Group balances (read-only) ──────────────────────────────────────────

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
