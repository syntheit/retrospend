/** Plan cost, year view and group targets. Mirrors src/lib/schemas/envelope*.ts (a test keeps them equal). */
import * as z from "zod";
import { moneySchema } from "../common/money";
import { idSchema } from "../core";
import { monthKeySchema } from "./basics";
import { groupTargetInputSchema } from "./inputs";

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
