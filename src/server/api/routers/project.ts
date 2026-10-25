/**
 * Project procedures: access checks and a call into src/server/services/project,
 * where the logic and the input schemas (inputs.ts) live.
 */
import {
	createTRPCRouter,
	guestOrProtectedProcedure,
	protectedProcedure,
} from "~/server/api/trpc";
import { userTransaction } from "~/server/db-tx";
import { listProjectExpenses } from "~/server/services/project/expenses.service";
import {
	projectBalancesFromPerspective,
	projectParticipantBalances,
	projectSettlementPlan,
} from "~/server/services/project/group.service";
import { projectInput } from "~/server/services/project/inputs";
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
import {
	membersOn,
	setMembershipDates,
} from "~/server/services/project/membership.service";
import { getProjectDetail, listProjects } from "~/server/services/project/project-read.service";
import {
	createProject,
	deleteProject,
	setAnalyticsExclusion,
	updateProject,
} from "~/server/services/project/project-write.service";
import { rebalanceExpenses } from "~/server/services/project/rebalance.mutation";
import { rebalanceableExpenses } from "~/server/services/project/rebalance.service";
import { getProjectSummary } from "~/server/services/project/summary.service";
import { requireProjectRole } from "~/server/services/shared-expenses/project-permissions";
import { requestTimeZone } from "~/server/time-zone";
import { projectPageProcedures } from "./project-pages";
import { assertReader, projectSharedProcedures } from "./project-shared";

type Db = Parameters<typeof requireProjectRole>[0];
type Zoned = { timeZone?: string };
type SignedIn = { db: Db; session: { user: { id: string } } } & Zoned;
type MinimumRole = Parameters<typeof requireProjectRole>[4];

/** The signed-in user's role in the project, or FORBIDDEN / NOT_FOUND. */
const roleOf = (ctx: SignedIn, projectId: string, minimum: MinimumRole) =>
	requireProjectRole(ctx.db, projectId, "user", ctx.session.user.id, minimum);

const actor = (ctx: SignedIn) => ({
	userId: ctx.session.user.id,
	timeZone: ctx.timeZone,
});

// ── router ────────────────────────────────────────────────────────────────────

export const projectRouter = createTRPCRouter({
	...projectPageProcedures,
	...projectSharedProcedures,

	create: protectedProcedure
		.input(projectInput.create)
		.mutation(({ ctx, input }) => createProject(ctx.db, actor(ctx), input)),

	list: protectedProcedure
		.input(projectInput.list)
		.query(({ ctx, input }) =>
			listProjects(ctx.db, ctx.session.user.id, input.status),
		),

	detail: guestOrProtectedProcedure
		.input(projectInput.byId)
		.query(async ({ ctx, input }) => {
			await assertReader(ctx, input.id);
			return getProjectDetail(ctx.db, input.id, ctx.participant);
		}),

	updateAnalyticsExclusion: protectedProcedure
		.input(projectInput.analyticsExclusion)
		.mutation(({ ctx, input }) =>
			setAnalyticsExclusion(ctx.db, actor(ctx), input.projectId, input.exclude),
		),

	update: protectedProcedure
		.input(projectInput.update)
		.mutation(async ({ ctx, input }) => {
			const { id, ...fields } = input;
			await roleOf(ctx, id, "EDITOR");
			return updateProject(ctx.db, actor(ctx), id, fields);
		}),

	addParticipant: protectedProcedure
		.input(projectInput.addParticipant)
		.mutation(async ({ ctx, input }) => {
			const caller = await roleOf(ctx, input.projectId, "EDITOR");
			return addParticipant(ctx.db, actor(ctx), caller.role, input);
		}),

	rebalanceableExpenses: protectedProcedure
		.input(projectInput.member)
		.query(async ({ ctx, input }) => {
			const { projectId, ...newcomer } = input;
			await roleOf(ctx, projectId, "EDITOR");
			return rebalanceableExpenses(ctx.db, actor(ctx), projectId, newcomer);
		}),

	rebalanceExpenses: protectedProcedure
		.input(projectInput.rebalance)
		.mutation(async ({ ctx, input }) => {
			await roleOf(ctx, input.projectId, "EDITOR");
			return userTransaction(ctx.db, ctx.session.user.id, (tx) =>
				rebalanceExpenses(tx, actor(ctx), input),
			);
		}),

	updateParticipantRole: protectedProcedure
		.input(projectInput.role)
		.mutation(async ({ ctx, input }) => {
			const caller = await roleOf(ctx, input.projectId, "EDITOR");
			return updateParticipantRole(ctx.db, actor(ctx), caller.role, input);
		}),

	transferOwnership: protectedProcedure
		.input(projectInput.transferOwnership)
		.mutation(async ({ ctx, input }) => {
			await roleOf(ctx, input.projectId, "ORGANIZER");
			return transferOwnership(ctx.db, actor(ctx), {
				projectId: input.projectId,
				newOwnerId: input.newOwnerParticipantId,
				confirmProjectName: input.confirmProjectName,
			});
		}),

	removeParticipant: protectedProcedure
		.input(projectInput.member)
		.mutation(async ({ ctx, input }) => {
			const caller = await roleOf(ctx, input.projectId, "EDITOR");
			return removeParticipant(ctx.db, actor(ctx), caller.role, input);
		}),

	/** Who was a member on a day: what a new expense on that day includes by default (RC-11). */
	membersOn: guestOrProtectedProcedure
		.input(projectInput.membersOn)
		.query(async ({ ctx, input }) => {
			await assertReader(ctx, input.projectId);
			const zone = requestTimeZone(ctx.headers);
			const user = ctx.participant.participantType === "user";
			const reader = user ? ctx.participant.participantId : null;
			return membersOn(ctx.db, input.projectId, input.date, reader, zone);
		}),

	/** Join and leave dates. Leaving keeps the person and their past expenses. */
	setMembershipDates: protectedProcedure
		.input(projectInput.membershipDates)
		.mutation(async ({ ctx, input }) => {
			const caller = await roleOf(ctx, input.projectId, "EDITOR");
			return setMembershipDates(ctx.db, actor(ctx), caller.role, input);
		}),

	listExpenses: guestOrProtectedProcedure
		.input(projectInput.listExpenses)
		.query(async ({ ctx, input }) => {
			const caller = await assertReader(ctx, input.projectId);
			return listProjectExpenses(ctx.db, input, ctx.participant, caller.role);
		}),

	delete: protectedProcedure
		.input(projectInput.byId)
		.mutation(async ({ ctx, input }) => {
			await roleOf(ctx, input.id, "ORGANIZER");
			return deleteProject(ctx.db, actor(ctx), input.id);
		}),

	// ── Magic links ─────────────────────────────────────────────────────────

	createMagicLink: protectedProcedure
		.input(projectInput.createMagicLink)
		.mutation(async ({ ctx, input }) => {
			assertGrantableByLink(input.roleGranted);
			await roleOf(ctx, input.projectId, "EDITOR");
			return createMagicLink(ctx.db, actor(ctx), input);
		}),

	listMagicLinks: protectedProcedure
		.input(projectInput.project)
		.query(async ({ ctx, input }) => {
			await roleOf(ctx, input.projectId, "EDITOR");
			return listMagicLinks(ctx.db, input.projectId);
		}),

	revokeMagicLink: protectedProcedure
		.input(projectInput.revokeMagicLink)
		.mutation(async ({ ctx, input }) => {
			await roleOf(ctx, input.projectId, "EDITOR");
			return revokeMagicLink(ctx.db, actor(ctx), input.projectId, input.linkId);
		}),

	resetMagicLink: protectedProcedure
		.input(projectInput.resetMagicLink)
		.mutation(async ({ ctx, input }) => {
			assertGrantableByLink(input.role);
			await roleOf(ctx, input.projectId, "EDITOR");
			return resetMagicLink(ctx.db, actor(ctx), input.projectId, input.role);
		}),

	// ── Public (no sign-in): PUBLIC projects only, no balances or emails ─────

	// ── Group balances (read-only) ──────────────────────────────────────────

	/** The fewest payments that settle the project (or one billing period), per currency. */
	settlementPlan: guestOrProtectedProcedure
		.input(projectInput.group)
		.query(async ({ ctx, input }) => {
			await assertReader(ctx, input.projectId);
			return projectSettlementPlan(ctx.db, input.projectId, input.periodId);
		}),

	/**
	 * The Summary tab: group total, Paid / Share / Received / Sent / Balance
	 * per member and currency in minor units, and who pays whom.
	 */
	summary: guestOrProtectedProcedure
		.input(projectInput.group)
		.query(async ({ ctx, input }) => {
			await assertReader(ctx, input.projectId);
			return getProjectSummary(
				ctx.db,
				input.projectId,
				ctx.participant,
				input.periodId,
			);
		}),

	/** Each person's paid, fair share and net balance, one row per currency. */
	participantBalances: guestOrProtectedProcedure
		.input(projectInput.group)
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
		.input(projectInput.perspective)
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
