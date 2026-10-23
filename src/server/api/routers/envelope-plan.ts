/**
 * Envelope procedures for planning (P5: SPEC §5.9, §5.10, §5.13), merged
 * flat into the envelope router (envelope.*). Thin: contracts from
 * ~/lib/schemas/envelope-plan, logic in the services. Rule list edits,
 * drafts and group targets move no money; the writes that do are preview
 * and apply pairs of one mutation (R30) whose undo is listed in it.
 */
import { z } from "zod";
import { applyOutputSchema, previewOutputSchema } from "~/lib/schemas/envelope";
import {
	applyDraftInputSchema,
	applyRuleResultSchema,
	applyRuleToMonthInputSchema,
	createRuleInputSchema,
	draftIdInputSchema,
	draftPreviewSchema,
	draftQueryInputSchema,
	draftResultSchema,
	draftSchema,
	draftsOutputSchema,
	fundNowInputSchema,
	groupTargetResultSchema,
	incomeRuleSchema,
	planCostInputSchema,
	planCostSchema,
	planFillInputSchema,
	planFillOutputSchema,
	reorderRulesInputSchema,
	ruleIdInputSchema,
	saveDraftInputSchema,
	setGroupTargetInputSchema,
	updateRuleInputSchema,
	yearViewInputSchema,
	yearViewSchema,
} from "~/lib/schemas/envelope-plan";
import {
	applyDraftMutation,
	applyRuleToMonthMutation,
	fundPlanNowMutation,
	unapplyDraftMutation,
} from "~/server/services/envelope/plan.mutation";
import {
	draftsApi,
	getPlanCost,
	getYearView,
	putGroupTarget,
	rulesApi,
} from "~/server/services/envelope/plan-api.service";
import { apply, envelopeProcedure, preview } from "./envelope-procedure";

const uid = (ctx: { session: { user: { id: string } } }) => ctx.session.user.id;

export const envelopePlanProcedures = {
	/** The Rules list, in the order rules run (SPEC §6.10). */
	rules: envelopeProcedure
		.output(z.array(incomeRuleSchema))
		.query(({ ctx }) => rulesApi.list(uid(ctx))),
	createRule: envelopeProcedure
		.input(createRuleInputSchema)
		.output(incomeRuleSchema)
		.mutation(({ ctx, input }) => rulesApi.create(uid(ctx), input)),
	updateRule: envelopeProcedure
		.input(updateRuleInputSchema)
		.output(incomeRuleSchema)
		.mutation(({ ctx, input }) => rulesApi.update(uid(ctx), input)),
	reorderRules: envelopeProcedure
		.input(reorderRulesInputSchema)
		.output(z.array(incomeRuleSchema))
		.mutation(({ ctx, input }) => rulesApi.reorder(uid(ctx), input.ids)),
	archiveRule: envelopeProcedure
		.input(ruleIdInputSchema)
		.output(incomeRuleSchema)
		.mutation(({ ctx, input }) => rulesApi.archive(uid(ctx), input.id)),

	applyRuleToMonthPreview: envelopeProcedure
		.input(applyRuleToMonthInputSchema)
		.output(previewOutputSchema(applyRuleResultSchema))
		.mutation(preview(applyRuleToMonthMutation)),
	applyRuleToMonth: envelopeProcedure
		.input(applyRuleToMonthInputSchema)
		.output(applyOutputSchema(applyRuleResultSchema))
		.mutation(apply(applyRuleToMonthMutation)),

	/** The open draft and, for a plan, the saved plan of a month. */
	drafts: envelopeProcedure
		.input(draftQueryInputSchema)
		.output(draftsOutputSchema)
		.query(({ ctx, input }) => draftsApi.get(uid(ctx), input)),
	saveDraft: envelopeProcedure
		.input(saveDraftInputSchema)
		.output(draftSchema)
		.mutation(({ ctx, input }) => draftsApi.save(uid(ctx), input)),
	discardDraft: envelopeProcedure
		.input(draftIdInputSchema)
		.output(draftSchema)
		.mutation(({ ctx, input }) => draftsApi.discard(uid(ctx), input.draftId)),
	/** What a draft would do; never writes (B4). */
	previewDraft: envelopeProcedure
		.input(draftIdInputSchema)
		.output(draftPreviewSchema)
		.query(({ ctx, input }) => draftsApi.preview(uid(ctx), input.draftId)),
	planFill: envelopeProcedure
		.input(planFillInputSchema)
		.output(planFillOutputSchema)
		.query(({ ctx, input }) => draftsApi.fill(uid(ctx), input)),

	applyDraftPreview: envelopeProcedure
		.input(applyDraftInputSchema)
		.output(previewOutputSchema(draftResultSchema))
		.mutation(preview(applyDraftMutation)),
	applyDraft: envelopeProcedure
		.input(applyDraftInputSchema)
		.output(applyOutputSchema(draftResultSchema))
		.mutation(apply(applyDraftMutation)),
	unapplyDraftPreview: envelopeProcedure
		.input(draftIdInputSchema)
		.output(previewOutputSchema(draftResultSchema))
		.mutation(preview(unapplyDraftMutation)),
	unapplyDraft: envelopeProcedure
		.input(draftIdInputSchema)
		.output(applyOutputSchema(draftResultSchema))
		.mutation(apply(unapplyDraftMutation)),
	fundPlanNowPreview: envelopeProcedure
		.input(fundNowInputSchema)
		.output(previewOutputSchema(draftResultSchema))
		.mutation(preview(fundPlanNowMutation)),
	fundPlanNow: envelopeProcedure
		.input(fundNowInputSchema)
		.output(applyOutputSchema(draftResultSchema))
		.mutation(apply(fundPlanNowMutation)),

	planCost: envelopeProcedure
		.input(planCostInputSchema)
		.output(planCostSchema)
		.query(({ ctx, input }) => getPlanCost(uid(ctx), input)),
	yearView: envelopeProcedure
		.input(yearViewInputSchema)
		.output(yearViewSchema)
		.query(({ ctx, input }) => getYearView(uid(ctx), input.year)),

	/** A group's target; moves no money. Undo: the same call with `previous`. */
	setGroupTarget: envelopeProcedure
		.input(setGroupTargetInputSchema)
		.output(groupTargetResultSchema)
		.mutation(({ ctx, input }) => putGroupTarget(uid(ctx), input)),
};
