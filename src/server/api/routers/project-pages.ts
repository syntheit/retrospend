/**
 * Project procedures of the redesigned pages (uiV2): the list and page
 * reads, and the previewed money actions (R30). Thin: access checks and a
 * call into src/server/services/project. Spread into projectRouter.
 */
import { z } from "zod";
import { protectedProcedure } from "~/server/api/trpc";
import { projectInput } from "~/server/services/project/inputs";
import { readProjectList } from "~/server/services/project/list-view";
import { previewMembershipDates } from "~/server/services/project/membership.service";
import { readProjectPage } from "~/server/services/project/page-view";
import {
	applySettleAll,
	previewSettleAll,
	undoSettleAll,
} from "~/server/services/project/settle-all.service";
import { requireProjectRole } from "~/server/services/shared-expenses/project-permissions";

type Db = Parameters<typeof requireProjectRole>[0];
type MinimumRole = Parameters<typeof requireProjectRole>[4];

const roleOf = (
	ctx: { db: Db; session: { user: { id: string } } },
	projectId: string,
	minimum: MinimumRole,
) =>
	requireProjectRole(ctx.db, projectId, "user", ctx.session.user.id, minimum);

const project = z.object({ projectId: z.string().min(1) });

export const projectPageProcedures = {
	/** The Projects list: every project you are in, with its figures. */
	listView: protectedProcedure.query(({ ctx }) =>
		readProjectList(ctx.db, ctx.session.user.id),
	),

	/** The project page for a member: header, hero, people, categories, payments, rows. */
	pageView: protectedProcedure
		.input(projectInput.byId)
		.query(async ({ ctx, input }) => {
			await roleOf(ctx, input.id, "VIEWER");
			return readProjectPage(ctx.db, input.id, ctx.session.user.id);
		}),

	/** What a membership date change moves (nothing already saved) before Save. */
	membershipDatesPreview: protectedProcedure
		.input(projectInput.membershipDates)
		.query(async ({ ctx, input }) => {
			const caller = await roleOf(ctx, input.projectId, "EDITOR");
			return previewMembershipDates(ctx.session.user.id, caller.role, input);
		}),

	/** Settle all, rolled back: the payments it would record and what they change. */
	settleAllPreview: protectedProcedure
		.input(project)
		.query(async ({ ctx, input }) => {
			await roleOf(ctx, input.projectId, "CONTRIBUTOR");
			return previewSettleAll(
				ctx.session.user.id,
				input.projectId,
				ctx.timeZone,
			);
		}),

	/** Records the payments the preview showed; CONFLICT when the balances moved. */
	settleAll: protectedProcedure
		.input(
			project.extend({
				expect: z
					.array(
						z.object({
							person: z.string().min(1),
							currency: z.string().min(1).max(10),
							minor: z.number().int(),
						}),
					)
					.max(200),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await roleOf(ctx, input.projectId, "CONTRIBUTOR");
			return applySettleAll(ctx.db, ctx.session.user.id, input, ctx.timeZone);
		}),

	/** Undo of settleAll: takes back the payments it wrote, all or none. */
	settleAllUndo: protectedProcedure
		.input(
			project.extend({
				paymentIds: z.array(z.string().min(1)).min(1).max(100),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await roleOf(ctx, input.projectId, "CONTRIBUTOR");
			return undoSettleAll(ctx.session.user.id, input);
		}),
};
