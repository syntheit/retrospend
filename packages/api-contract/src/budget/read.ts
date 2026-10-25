/** Month, fill, cover, history and setup preset outputs. Mirrors src/lib/schemas/envelope*.ts (a test keeps them equal). */
import * as z from "zod";
import { moneySchema } from "../common/money";
import { idSchema, timestampSchema } from "../core";
import {
	budgetStyleSchema,
	envelopeKindSchema,
	groupRoleSchema,
	isoDateSchema,
	missingRateSchema,
	monthKeySchema,
	movementKindSchema,
	setupStyleSchema,
} from "./basics";
import { owedSummarySchema } from "./close-owed";
import {
	groupTargetInputSchema,
	presetRuleSchema,
	targetInputSchema,
} from "./inputs";
import {
	envelopeGroupSchema,
	leftToSpendSchema,
	monthStateSchema,
	toAssignSchema,
	verdictSchema,
} from "./month";

export const getMonthOutputSchema = z.object({
	book: z.object({
		id: idSchema,
		style: budgetStyleSchema,
		fundingSource: z.enum(["INCOME", "TARGETS"]),
		currency: z.string(),
		startMonth: monthKeySchema,
		weekStartDay: z.number().int(),
		defaultEnvelopeId: idSchema,
		/** Switched to Just track (SPEC §4.4): Budget shows tracking, no items. */
		paused: z.boolean(),
	}),
	month: z.object({
		key: monthKeySchema,
		from: isoDateSchema,
		to: isoDateSchema,
		state: monthStateSchema,
	}),
	today: isoDateSchema,
	toAssign: toAssignSchema,
	groups: z.array(envelopeGroupSchema),
	leftToSpend: leftToSpendSchema,
	verdict: verdictSchema,
	owed: owedSummarySchema,
	shares: z.object({
		/** Your shares this month with no category: in "Everything else" until you pick (D19). */
		unresolved: z.number().int().min(0),
		/** Your shares this month still waiting for your OK (D20): counted, flagged. */
		pending: moneySchema,
	}),
	incomplete: z.boolean(),
	/** Some foreign rows were valued at the nearest rate there was, not one of their day: the UI shows "≈". */
	approximate: z.boolean(),
	missingRates: z.array(missingRateSchema),
});

export const fillLineSchema = z.object({
	envelopeId: idSchema,
	/** The month it is assigned in: the viewed month, or the next one for "Next month". */
	month: monthKeySchema,
	amount: moneySchema,
	/** PLAN: the saved plan for the month (owner r5 Q1). REST: the rest after the targets, where you chose to put it. */
	step: z.enum([
		"PLAN",
		"OVERSPENT",
		"BILL",
		"GROUP",
		"MONTHLY",
		"SAVINGS",
		"REST",
	]),
});

/** Where the rest goes after Use my plan (D-owner-2026-10-22e): nothing moves unseen. */
export const restChoiceSchema = z.enum(["LEAVE", "SAVE", "NEXT_MONTH"]);

export const restOptionSchema = z.object({
	choice: restChoiceSchema,
	/** SAVE: the savings envelope it goes to. */
	envelopeId: idSchema.nullable(),
	/** NEXT_MONTH: the month it is assigned to. */
	month: monthKeySchema.nullable(),
});

export const fillFromTargetsOutputSchema = z.object({
	month: monthKeySchema,
	available: moneySchema,
	lines: z.array(fillLineSchema),
	/** Each envelope's total over its lines (the plan's and the targets'), in the order of first appearance. */
	totals: z.array(z.object({ envelopeId: idSchema, amount: moneySchema })),
	/** What stays Not planned yet after the lines (D-owner-2026-10-22e). */
	rest: moneySchema,
	/** The choices for the rest; Leave it is the default. */
	restOptions: z.array(restOptionSchema),
});

export const coverSourceSchema = z.object({
	/** null = To assign. */
	from: idSchema.nullable(),
	kind: z.enum(["POOL", "MONTHLY", "SAVINGS", "BILL", "NONE"]),
	available: moneySchema,
	/** Bills come last with their due date ("Due Nov 5"). */
	dueDate: isoDateSchema.nullable(),
});

/** Covering one envelope: how much it is over by, where it can come from, and where the server suggests. */
export const coverOverviewSchema = z.object({
	/** What the envelope is over by (0 when it is not over). */
	need: moneySchema,
	/** The suggested source: never a goal or a bill by default. Null = none fits. */
	suggested: z.object({ from: idSchema.nullable() }).nullable(),
	sources: z.array(coverSourceSchema),
});

export const movementSchema = z.object({
	id: idSchema,
	month: monthKeySchema,
	from: idSchema.nullable(),
	to: idSchema.nullable(),
	amount: moneySchema,
	kind: movementKindSchema,
	batchId: idSchema.nullable(),
	revertsId: idSchema.nullable(),
	createdAt: timestampSchema,
	/** Not yet undone, not an undo itself, and in an open month. */
	canUndo: z.boolean(),
});

export const historyOutputSchema = z.object({
	items: z.array(movementSchema),
	nextCursor: idSchema.nullable(),
});

export const movementResultSchema = z.object({
	movements: z.array(movementSchema.omit({ canUndo: true })),
	/** Every envelope the write moved, with its Left before and after (RC-5: every line listed). */
	envelopes: z.array(
		z.object({ id: idSchema, before: moneySchema, after: moneySchema }),
	),
	toAssign: z.object({ before: moneySchema, after: moneySchema }),
});

export const setupPresetOutputSchema = z.object({
	style: setupStyleSchema,
	currency: z.string(),
	/** Limits: spending rows without a rate were left out of the proposed limits (R14). */
	missingRates: z.array(missingRateSchema).default([]),
	/** Names are message keys the client translates and sends back to setup. */
	groups: z.array(
		z.object({
			key: z.string(),
			nameKey: z.string(),
			role: groupRoleSchema,
			target: z.lazy(() => groupTargetInputSchema).optional(),
		}),
	),
	/** Save first: "20% of money in to Savings", "The rest to Spending" (the percentage is asked). */
	rules: z.array(z.lazy(() => presetRuleSchema)).optional(),
	envelopes: z.array(
		z.object({
			key: z.string(),
			/** Save first asks whether this envelope's leftovers sweep to the savings goal. */
			sweepToKey: z.string().optional(),
			nameKey: z.string().nullable(),
			/** A recurring template's or category's own name, when the envelope follows one. */
			name: z.string().nullable(),
			groupKey: z.string(),
			kind: envelopeKindSchema,
			isDefault: z.boolean(),
			categoryIds: z.array(idSchema),
			templateId: idSchema.nullable(),
			target: z.lazy(() => targetInputSchema).nullable(),
		}),
	),
});
