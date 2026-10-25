/** Month close summaries and money owed. Mirrors src/lib/schemas/envelope*.ts (a test keeps them equal). */
import * as z from "zod";
import { moneySchema } from "../common/money";
import { idSchema } from "../core";
import { isoDateSchema, minorSchema, monthKeySchema } from "./basics";

// ── Month close (P4, SPEC §5.5) ─────────────────────────────────────────────

export const leftoverRuleSchema = z.enum(["CARRY", "RETURN", "SWEEP"]);

/** One envelope at the end of a closed month, in book-currency minor units. */
export const monthCloseEnvelopeSchema = z.object({
	id: idSchema,
	carryIn: minorSchema,
	assigned: minorSchema,
	activity: minorSchema,
	left: minorSchema,
	/** The rule it closed under (B7: a later change applies from the next close). */
	rule: leftoverRuleSchema,
	sweepToId: idSchema.nullable(),
	carried: minorSchema,
	returned: minorSchema,
	swept: minorSchema,
	/** max(0, -Left): taken from next month's To assign (D4). */
	overspent: minorSchema,
});

/** What `month_close.summary` stores (book-currency minor units). */
export const monthCloseSummarySchema = z.object({
	month: monthKeySchema,
	currency: z.string(),
	moneyIn: minorSchema,
	assigned: minorSchema,
	overspent: minorSchema,
	returned: minorSchema,
	/** Held for others at the end of the month, per person and currency (D9). */
	held: z.array(
		z.object({
			counterparty: z.string(),
			currency: z.string(),
			native: minorSchema,
			held: minorSchema,
		}),
	),
	envelopes: z.array(monthCloseEnvelopeSchema),
	/**
	 * Category to envelope routing the month closed with: moving a category
	 * later routes only the open months there (B7). Absent on closes made
	 * before routing was kept.
	 */
	links: z.record(z.string(), z.string()).optional(),
});

// ── Splits and money owed (P3, SPEC §5.8) ───────────────────────────────────

export const participantRefSchema = z.object({
	type: z.enum(["user", "guest", "shadow"]),
	id: z.string().min(1).max(191),
});

export const owedLineSchema = z.object({
	/** In the balance's own currency. Positive: they owe you; negative: you owe them. */
	amount: moneySchema,
	/** What the budget holds for it: the book value of what they owe you. */
	held: moneySchema,
	/** When the oldest part still owed started (first in, first out). */
	oldestOpen: isoDateSchema.nullable(),
	ageDays: z.number().int().nullable(),
});

export const owedPersonSchema = z.object({
	participant: participantRefSchema,
	name: z.string().nullable(),
	lines: z.array(owedLineSchema),
	held: moneySchema,
	/** Payments to you waiting for your OK (D8): shown, not counted. */
	pending: moneySchema,
	lastPaidOn: isoDateSchema.nullable(),
	ageDays: z.number().int().nullable(),
	/** Owed 60 days or more with no payment in 60 days (C15): Remind or Forgive. */
	aging: z.boolean(),
});

export const owedSchema = z.object({
	held: moneySchema,
	pending: moneySchema,
	people: z.array(owedPersonSchema),
	/** Projects you count "Not in budget" (D31): listed, never counted. */
	notInBudget: z.array(z.object({ projectId: idSchema, name: z.string() })),
	incomplete: z.boolean(),
});

/** The Owed line on the Budget page. */
export const owedSummarySchema = z.object({
	held: moneySchema,
	pending: moneySchema,
	/** People who owe you money the budget holds. */
	people: z.number().int().min(0),
	aging: z.number().int().min(0),
});

export const shareCategorySourceSchema = z.enum([
	"USER",
	"NAME_MATCH",
	"PROJECT",
	"PERSON",
	"TITLE",
]);
export const projectBudgetRoutingSchema = z.enum([
	"CATEGORY",
	"ENVELOPE",
	"NOT_IN_BUDGET",
]);
