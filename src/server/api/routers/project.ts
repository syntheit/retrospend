/**
 * Project procedures: input schemas, access checks, and a call into
 * src/server/services/project. Logic lives in the services.
 */
import { z } from "zod";
import {
	assertGuestProjectScope,
	createTRPCRouter,
	guestOrProtectedProcedure,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import { userTransaction } from "~/server/db-tx";
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
	assertGrantableByLink,
	createMagicLink,
	listMagicLinks,
	resetMagicLink,
	revokeMagicLink,
} from "~/server/services/project/magic-links.service";
import {
	addParticipant,
	removeParticipant,
	transferOwnership,
	updateParticipantRole,
} from "~/server/services/project/members.service";
import { isIsoDate } from "~/server/services/project/membership";
import {
	membersOn,
	setMembershipDates,
} from "~/server/services/project/membership.service";
import {
	getProjectDetail,
	getPublicProjectDetail,
	listProjects,
} from "~/server/services/project/project-read.service";
import {
	createProject,
	deleteProject,
	setAnalyticsExclusion,
	updateProject,
} from "~/server/services/project/project-write.service";
import { rebalanceExpenses } from "~/server/services/project/rebalance.mutation";
import { rebalanceableExpenses } from "~/server/services/project/rebalance.service";
import { requireProjectRole } from "~/server/services/shared-expenses/project-permissions";

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

/** A calendar day, YYYY-MM-DD, as the client's local date. */
const isoDateSchema = z
	.string()
	.refine(isIsoDate, { message: "Expected a calendar day (YYYY-MM-DD)" });

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
		.mutation(({ ctx, input }) => createProject(ctx.db, actor(ctx), input)),

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
		.input(z.object({ projectId: z.string().min(1), exclude: z.boolean() }))
		.mutation(({ ctx, input }) =>
			setAnalyticsExclusion(ctx.db, actor(ctx), input.projectId, input.exclude),
		),

	update: protectedProcedure
		.input(updateProjectSchema)
		.mutation(async ({ ctx, input }) => {
			const { id, ...fields } = input;
			await roleOf(ctx, id, "EDITOR");
			return updateProject(ctx.db, actor(ctx), id, fields);
		}),

	addParticipant: protectedProcedure
		.input(
			memberSchema.extend({
				role: projectRoleSchema.default("CONTRIBUTOR"),
				joinedOn: isoDateSchema.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const caller = await roleOf(ctx, input.projectId, "EDITOR");
			return addParticipant(ctx.db, actor(ctx), caller.role, input);
		}),

	rebalanceableExpenses: protectedProcedure
		.input(memberSchema)
		.query(async ({ ctx, input }) => {
			const { projectId, ...newcomer } = input;
			await roleOf(ctx, projectId, "EDITOR");
			return rebalanceableExpenses(ctx.db, projectId, newcomer);
		}),

	rebalanceExpenses: protectedProcedure
		.input(
			memberSchema.extend({
				expenseIds: z.array(z.string().min(1)).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await roleOf(ctx, input.projectId, "EDITOR");
			return userTransaction(ctx.db, ctx.session.user.id, (tx) =>
				rebalanceExpenses(tx, actor(ctx), input),
			);
		}),

	updateParticipantRole: protectedProcedure
		.input(memberSchema.extend({ role: projectRoleSchema }))
		.mutation(async ({ ctx, input }) => {
			const caller = await roleOf(ctx, input.projectId, "EDITOR");
			return updateParticipantRole(ctx.db, actor(ctx), caller.role, input);
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
			await roleOf(ctx, input.projectId, "ORGANIZER");
			return transferOwnership(ctx.db, actor(ctx), {
				projectId: input.projectId,
				newOwnerId: input.newOwnerParticipantId,
				confirmProjectName: input.confirmProjectName,
			});
		}),

	removeParticipant: protectedProcedure
		.input(memberSchema)
		.mutation(async ({ ctx, input }) => {
			const caller = await roleOf(ctx, input.projectId, "EDITOR");
			return removeParticipant(ctx.db, actor(ctx), caller.role, input);
		}),

	/** Who was a member on a day: what a new expense on that day includes by default (RC-11). */
	membersOn: guestOrProtectedProcedure
		.input(z.object({ projectId: z.string().min(1), date: isoDateSchema }))
		.query(async ({ ctx, input }) => {
			await assertReader(ctx, input.projectId);
			return membersOn(ctx.db, input.projectId, input.date);
		}),

	/** Join and leave dates. Leaving keeps the person and their past expenses. */
	setMembershipDates: protectedProcedure
		.input(
			memberSchema.extend({
				joinedOn: isoDateSchema.nullish(),
				leftOn: isoDateSchema.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await roleOf(ctx, input.projectId, "EDITOR");
			return setMembershipDates(ctx.db, actor(ctx), input);
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
			await roleOf(ctx, input.id, "ORGANIZER");
			return deleteProject(ctx.db, actor(ctx), input.id);
		}),

	// ── Magic links ─────────────────────────────────────────────────────────

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
			assertGrantableByLink(input.roleGranted);
			await roleOf(ctx, input.projectId, "EDITOR");
			return createMagicLink(ctx.db, actor(ctx), input);
		}),

	listMagicLinks: protectedProcedure
		.input(z.object({ projectId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			await roleOf(ctx, input.projectId, "EDITOR");
			return listMagicLinks(ctx.db, input.projectId);
		}),

	revokeMagicLink: protectedProcedure
		.input(
			z.object({ projectId: z.string().min(1), linkId: z.string().min(1) }),
		)
		.mutation(async ({ ctx, input }) => {
			await roleOf(ctx, input.projectId, "EDITOR");
			return revokeMagicLink(ctx.db, actor(ctx), input.projectId, input.linkId);
		}),

	resetMagicLink: protectedProcedure
		.input(z.object({ projectId: z.string().min(1), role: projectRoleSchema }))
		.mutation(async ({ ctx, input }) => {
			assertGrantableByLink(input.role);
			await roleOf(ctx, input.projectId, "EDITOR");
			return resetMagicLink(ctx.db, actor(ctx), input.projectId, input.role);
		}),

	// ── Public (no sign-in): PUBLIC projects only, no balances or emails ─────

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
