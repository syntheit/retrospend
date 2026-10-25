/** Results and inputs of setup, splits and close writes. Mirrors src/lib/schemas/envelope*.ts (a test keeps them equal). */
import * as z from "zod";
import { moneySchema } from "../common/money";
import { idSchema } from "../core";
import {
	clientIdSchema,
	monthKeySchema,
	positiveAmount,
	setupStyleSchema,
} from "./basics";
import {
	participantRefSchema,
	projectBudgetRoutingSchema,
	shareCategorySourceSchema,
} from "./close-owed";

export const setupResultSchema = z.object({
	bookId: idSchema,
	/**
	 * What you and each person owe each other as the budget starts, per
	 * person and currency, never netted (owner 2026-10-23): part of the
	 * starting position. Positive: they owe you (counts when it arrives);
	 * negative: you owe them (leaves To assign when you pay).
	 */
	openBalances: z.array(
		z.object({ participant: participantRefSchema, amount: moneySchema }),
	),
	/**
	 * What the plan costs a month against what you start with (the stop when
	 * it costs more than you have). Null for a style that funds itself
	 * (Limits asks for no money now).
	 */
	plan: z
		.object({
			cost: moneySchema,
			available: moneySchema,
			/** max(0, cost - available): what the plan costs beyond what you have. */
			short: moneySchema,
		})
		.nullable(),
});

export const setShareCategoryInputSchema = z.object({
	transactionId: idSchema,
	/** One of your expense categories; null clears it (Everything else). */
	categoryId: idSchema.nullable(),
	/** USER from the picker; undo passes back what was stored before. */
	source: shareCategorySourceSchema.default("USER"),
});

export const shareCategoryResultSchema = z.object({
	shareId: idSchema,
	categoryId: idSchema.nullable(),
	source: shareCategorySourceSchema.nullable(),
	/** What it was: the undo sets it back. */
	previous: z.object({
		categoryId: idSchema.nullable(),
		source: shareCategorySourceSchema.nullable(),
	}),
});

export const setProjectRoutingInputSchema = z
	.object({
		projectId: idSchema,
		routing: projectBudgetRoutingSchema,
		/** ENVELOPE only: every share of yours in the project lands here. */
		envelopeId: idSchema.nullable().default(null),
	})
	.refine(
		(r) => (r.routing === "ENVELOPE") === (r.envelopeId !== null),
		"pick an envelope exactly when counting the project in one envelope",
	);

export const projectRoutingResultSchema = z.object({
	projectId: idSchema,
	/** Your project_participant row: what the undo sets back. */
	participantId: idSchema,
	routing: projectBudgetRoutingSchema,
	envelopeId: idSchema.nullable(),
	previous: z.object({
		routing: projectBudgetRoutingSchema,
		envelopeId: idSchema.nullable(),
	}),
});

export const forgiveInputSchema = z.object({
	/** Client id of the forgive (its payment id): retries are idempotent. */
	id: clientIdSchema,
	participant: participantRefSchema,
	/** The balance's currency. */
	currency: z.string().min(3).max(10),
	/** In `currency`, at most what they owe you there. */
	amount: positiveAmount,
	/** The envelope it is charged to; null: Everything else. */
	envelopeId: idSchema.nullable(),
});

export const forgiveResultSchema = z.object({
	paymentId: idSchema,
	amount: moneySchema,
	/** What leaves the held money and is charged to the envelope, in the book currency; null without a budget. */
	charged: moneySchema.nullable(),
	envelopeId: idSchema.nullable(),
});

export const unforgiveInputSchema = z.object({ paymentId: idSchema });

export const carryOverspendInputSchema = z.object({
	/** Client id of the movement: retries are idempotent. */
	id: clientIdSchema,
	/** The envelope that went over last month; it takes the overspend this month instead. */
	envelopeId: idSchema,
	amount: positiveAmount,
});

/** Fix a negative To assign, or start fresh (reset): one batch this month. */
export const batchInputSchema = z.object({ batchId: clientIdSchema });

export const monthSummaryInputSchema = z.object({ month: monthKeySchema });

export const fillFromTargetsInputSchema = z
	.object({
		month: monthKeySchema.optional(),
		/** Plan only this much (an income that just arrived); default: all of To assign. */
		amount: positiveAmount.optional(),
	})
	.default({});

export const setupPresetInputSchema = z.object({ style: setupStyleSchema });
