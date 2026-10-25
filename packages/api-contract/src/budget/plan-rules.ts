/** Income rules. Mirrors src/lib/schemas/envelope*.ts (a test keeps them equal). */
import * as z from "zod";
import { moneySchema } from "../common/money";
import { userText } from "../common/user-text";
import { idSchema, timestampSchema } from "../core";
import { clientIdSchema } from "./basics";
import { ruleActionInputSchema, ruleMatchSchema } from "./inputs";
import { movementResultSchema } from "./read";

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
	createdAt: timestampSchema,
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
