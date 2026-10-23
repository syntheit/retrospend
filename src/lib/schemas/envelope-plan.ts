/**
 * Contract for budget planning (build plan 02 §8 P5; SPEC §5.9, §5.10,
 * §5.13): income rules, Plan next month and What if drafts, plan cost and
 * runway, the year view and group targets. Same conventions as
 * ./envelope: Money DTOs in integer minor units, months as YYYYMM.
 *
 * Drafts carry ids and amounts only, never free text (E2EE rule 10): an
 * expected money in is named by its recurring template or category, a
 * pretend row by its category or envelope.
 */

import { userText } from "@retrospend/api-contract/common";
import { z } from "zod";
import {
	groupTargetInputSchema,
	minorSchema,
	moneySchema,
	monthKeySchema,
	movementResultSchema,
	ruleActionInputSchema,
	ruleMatchSchema,
} from "./envelope";

const idSchema = z.string().min(1).max(64);
const clientIdSchema = z.string().uuid();
const positiveMinor = minorSchema.refine((v) => v > 0, "must be above 0");
const nonNegativeMinor = minorSchema.refine((v) => v >= 0, "must be 0 or more");

// ── Income rules (SPEC §5.10) ───────────────────────────────────────────────

export const ruleActionSchema = z.object({
	kind: z.enum(["PERCENT", "AMOUNT", "REMAINDER"]),
	/** PERCENT: basis points (2000 = 20%). */
	basisPoints: z.number().int().nullable(),
	/** AMOUNT: in the book currency. */
	amount: moneySchema.nullable(),
});

export const incomeRuleSchema = z.object({
	id: idSchema,
	name: z.string(),
	sortOrder: z.number().int(),
	match: ruleMatchSchema,
	action: ruleActionSchema,
	envelopeId: idSchema,
	active: z.boolean(),
	/** Rules apply to money in created after this. */
	createdAt: z.date(),
});

export const createRuleInputSchema = z.object({
	id: clientIdSchema,
	name: userText("incomeRule.name", 64),
	match: ruleMatchSchema,
	action: ruleActionInputSchema,
	envelopeId: idSchema,
});

export const updateRuleInputSchema = z.object({
	id: idSchema,
	name: userText("incomeRule.name", 64).optional(),
	match: ruleMatchSchema.optional(),
	action: ruleActionInputSchema.optional(),
	envelopeId: idSchema.optional(),
	/** Pause or resume; a paused rule never touches past batches. */
	active: z.boolean().optional(),
});

export const reorderRulesInputSchema = z.object({
	ids: z.array(idSchema).min(1).max(100),
});

export const ruleIdInputSchema = z.object({ id: idSchema });

/** "Also apply to this month's money in" (SPEC §5.10). */
export const applyRuleToMonthInputSchema = z.object({
	batchId: clientIdSchema,
	ruleId: idSchema,
});

export const ruleRunSchema = z.object({
	/** The money in the rules ran on. */
	expenseId: idSchema,
	batchId: idSchema,
	lines: z.array(
		z.object({ ruleId: idSchema, envelopeId: idSchema, amount: moneySchema }),
	),
});

export const applyRuleResultSchema = z.object({
	runs: z.array(ruleRunSchema),
	movement: movementResultSchema.nullable(),
});

// ── Drafts: Plan next month and What if (SPEC §5.13, D2, D54) ───────────────

export const draftKindSchema = z.enum(["PLAN", "WHAT_IF"]);
export const draftStatusSchema = z.enum(["OPEN", "APPLIED", "DISCARDED"]);

/** PLAN: what the envelope should have assigned in the month. */
export const planLineSchema = z.object({
	envelopeId: idSchema,
	amountMinor: nonNegativeMinor,
});

/** WHAT_IF: a pretend move; Apply writes only these (D54). null = To assign. */
export const draftMoveSchema = z.object({
	id: clientIdSchema,
	from: idSchema.nullable(),
	to: idSchema.nullable(),
	amountMinor: positiveMinor,
});

/** Expected money in: sizes the plan, never written as money in (D16). */
export const expectedInSchema = z.object({
	id: clientIdSchema,
	templateId: idSchema.nullable(),
	categoryId: idSchema.nullable(),
	amountMinor: positiveMinor,
});

/** WHAT_IF: a pretend expense (OUT) or money in (IN), never written. */
export const pretendRowSchema = z.object({
	id: clientIdSchema,
	kind: z.enum(["OUT", "IN"]),
	categoryId: idSchema.nullable(),
	/** OUT straight into one envelope ("What if I spend…" on an envelope). */
	envelopeId: idSchema.nullable(),
	amountMinor: positiveMinor,
});

export const saveDraftInputSchema = z
	.object({
		id: clientIdSchema,
		kind: draftKindSchema,
		month: monthKeySchema,
		lines: z.array(planLineSchema).max(200).default([]),
		moves: z.array(draftMoveSchema).max(100).default([]),
		expectedIn: z.array(expectedInSchema).max(50).default([]),
		pretend: z.array(pretendRowSchema).max(100).default([]),
	})
	.refine(
		(d) => new Set(d.lines.map((l) => l.envelopeId)).size === d.lines.length,
		"an envelope appears once in a plan",
	)
	.refine(
		(d) =>
			d.kind === "WHAT_IF" || (d.moves.length === 0 && d.pretend.length === 0),
		"pretend rows and moves belong to What if",
	);

export const draftSchema = z.object({
	id: idSchema,
	kind: draftKindSchema,
	month: monthKeySchema,
	status: draftStatusSchema,
	lines: z.array(planLineSchema),
	moves: z.array(draftMoveSchema),
	expectedIn: z.array(expectedInSchema),
	pretend: z.array(pretendRowSchema),
	appliedAt: z.date().nullable(),
	fundedBatchId: idSchema.nullable(),
	updatedAt: z.date(),
});

export const draftQueryInputSchema = z.object({
	kind: draftKindSchema,
	month: monthKeySchema.optional(),
});

export const draftsOutputSchema = z.object({
	month: monthKeySchema,
	/** The draft being edited, if any. */
	open: draftSchema.nullable(),
	/** PLAN: the saved plan Use my plan starts from when the month's money arrives. */
	saved: draftSchema.nullable(),
});

export const draftIdInputSchema = z.object({ draftId: idSchema });

/** "Fill from targets", "Same as this month", "What this month spent" (SPEC §5.13). */
export const planFillInputSchema = z.object({
	source: z.enum(["TARGETS", "SAME_AS_THIS_MONTH", "THIS_MONTH_SPENT"]),
});

export const planFillOutputSchema = z.object({
	month: monthKeySchema,
	lines: z.array(planLineSchema),
});

const beforeAfter = z.object({ before: moneySchema, after: moneySchema });

export const draftEnvelopeLineSchema = z.object({
	envelopeId: idSchema,
	assigned: beforeAfter,
	activity: beforeAfter,
	left: beforeAfter,
	/** The target's need with the draft in place. */
	need: moneySchema,
	/** Left below 0 with the draft in place. */
	short: z.boolean(),
});

export const draftPreviewSchema = z.object({
	draftId: idSchema,
	kind: draftKindSchema,
	month: monthKeySchema,
	/** The draft month's To assign (Not planned yet) without and with the draft. */
	toAssign: beforeAfter,
	/** Every envelope the draft moves (RC-5). */
	envelopes: z.array(draftEnvelopeLineSchema),
	/** Income rules previewed on expected and pretend money in. */
	ruleLines: z.array(
		z.object({
			sourceId: idSchema,
			ruleId: idSchema,
			envelopeId: idSchema,
			amount: moneySchema,
		}),
	),
	/** Envelopes that go short, each with a suggested cover. */
	shortfalls: z.array(
		z.object({
			envelopeId: idSchema,
			short: moneySchema,
			cover: z.array(
				z.object({ from: idSchema.nullable(), amount: moneySchema }),
			),
			/** Part of the shortfall nothing can cover. */
			uncovered: moneySchema,
		}),
	),
	/** PLAN: what "Fund it now" would take from this month's Not planned yet. */
	fundNow: moneySchema.nullable(),
	incomplete: z.boolean(),
	/** The draft names its month, which is no longer the current or next one. */
	stale: z.boolean(),
});

export const applyDraftInputSchema = z.object({
	draftId: idSchema,
	/** WHAT_IF: client id of the moves' batch. */
	batchId: clientIdSchema.optional(),
});

export const draftResultSchema = z.object({
	draft: draftSchema,
	/** PLAN: the saved plan this one replaced. */
	supersededId: idSchema.nullable(),
	/** The moves written (What if, Fund it now); null when nothing moved. */
	movement: movementResultSchema.nullable(),
});

export const fundNowInputSchema = z.object({
	draftId: idSchema,
	batchId: clientIdSchema,
});

// ── Plan cost, runway, year view (SPEC §5.13, E6, B15, D9) ─────────────────

export const planCostInputSchema = z
	.object({
		month: monthKeySchema.optional(),
		/** "Essentials only": these envelopes; default the Bills group and every bill. */
		essentialIds: z.array(idSchema).max(200).optional(),
	})
	.default({});

export const planCostSchema = z.object({
	month: monthKeySchema,
	/** Σ monthly-equivalent targets; a group counts its target when larger than its children. */
	cost: moneySchema,
	byGroup: z.array(
		z.object({ groupId: idSchema.nullable(), cost: moneySchema }),
	),
	/** Median budget income of the last 3 closed months; null with none. */
	typicalIncome: moneySchema.nullable(),
	closedMonths: z.number().int().min(0).max(3),
	essentialCost: moneySchema,
	essentialIds: z.array(idSchema),
	/** "Your budget and savings last 7.5 months at this plan"; null when essentials cost nothing. */
	runway: z
		.object({
			available: moneySchema,
			/** Whole tenths of a month, rounded down (75 = 7.5 months). */
			tenths: z.number().int(),
		})
		.nullable(),
	incomplete: z.boolean(),
});

export const yearViewInputSchema = z
	.object({ year: z.number().int().min(1900).max(2999).optional() })
	.default({});

export const yearCellSchema = z.object({
	month: monthKeySchema,
	/** Null before the budget started: those months show spending only (D9). */
	assigned: moneySchema.nullable(),
	spent: moneySchema,
	left: moneySchema.nullable(),
});

export const yearViewSchema = z.object({
	year: z.number().int(),
	months: z.array(
		z.object({
			key: monthKeySchema,
			state: z.enum(["BEFORE_START", "CLOSED", "OPEN", "NEXT", "LATER"]),
		}),
	),
	envelopes: z.array(
		z.object({
			id: idSchema,
			groupId: idSchema.nullable(),
			cells: z.array(yearCellSchema),
		}),
	),
	incomplete: z.boolean(),
});

// ── Group targets (SPEC §5.9) ───────────────────────────────────────────────

export const setGroupTargetInputSchema = z.object({
	groupId: idSchema,
	target: groupTargetInputSchema,
	/** Receives the group need left after child targets; null: the first envelope without a target. */
	mainEnvelopeId: idSchema.nullable().optional(),
});

export const groupTargetResultSchema = z.object({
	groupId: idSchema,
	target: groupTargetInputSchema,
	mainEnvelopeId: idSchema.nullable(),
	/** What it was before, so the undo restores it. */
	previous: z.object({
		target: groupTargetInputSchema,
		mainEnvelopeId: idSchema.nullable(),
	}),
});

export type IncomeRuleDto = z.infer<typeof incomeRuleSchema>;
export type CreateRuleInput = z.infer<typeof createRuleInputSchema>;
export type UpdateRuleInput = z.infer<typeof updateRuleInputSchema>;
export type ApplyRuleToMonthInput = z.infer<typeof applyRuleToMonthInputSchema>;
export type ApplyRuleResult = z.infer<typeof applyRuleResultSchema>;
export type RuleRunDto = z.infer<typeof ruleRunSchema>;
export type DraftKind = z.infer<typeof draftKindSchema>;
export type PlanLine = z.infer<typeof planLineSchema>;
export type DraftMove = z.infer<typeof draftMoveSchema>;
export type ExpectedIn = z.infer<typeof expectedInSchema>;
export type PretendRow = z.infer<typeof pretendRowSchema>;
export type SaveDraftInput = z.infer<typeof saveDraftInputSchema>;
export type DraftDto = z.infer<typeof draftSchema>;
export type DraftsOutput = z.infer<typeof draftsOutputSchema>;
export type PlanFillInput = z.infer<typeof planFillInputSchema>;
export type PlanFillOutput = z.infer<typeof planFillOutputSchema>;
export type DraftPreview = z.infer<typeof draftPreviewSchema>;
export type ApplyDraftInput = z.infer<typeof applyDraftInputSchema>;
export type DraftResult = z.infer<typeof draftResultSchema>;
export type FundNowInput = z.infer<typeof fundNowInputSchema>;
export type PlanCostInput = z.infer<typeof planCostInputSchema>;
export type PlanCostDto = z.infer<typeof planCostSchema>;
export type YearViewDto = z.infer<typeof yearViewSchema>;
export type SetGroupTargetInput = z.infer<typeof setGroupTargetInputSchema>;
export type GroupTargetResult = z.infer<typeof groupTargetResultSchema>;
