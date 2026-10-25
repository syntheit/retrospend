/** Month summaries, Welcome back and the bank side. Mirrors src/lib/schemas/envelope*.ts (a test keeps them equal). */
import * as z from "zod";
import { moneySchema } from "../common/money";
import { idSchema, timestampSchema } from "../core";
import { isoDateSchema, missingRateSchema, monthKeySchema } from "./basics";
import { monthCloseSummarySchema } from "./close-owed";

// ── Month summary (SPEC §5.5, §6.6) ─────────────────────────────────────────

/** What a change after the late window did to today's numbers (C16). */
export const monthChangeSchema = z.object({
	/** The earliest closed month the change reached. */
	earliestMonth: monthKeySchema,
	toAssign: moneySchema,
	envelopes: z.array(z.object({ id: idSchema, delta: moneySchema })),
	at: z.string(),
});

export const monthSummaryOutputSchema = z.object({
	summary: monthCloseSummarySchema,
	closedAt: timestampSchema,
	revision: z.number().int().min(1),
	/** The revision the person acknowledged; null until they do. */
	acknowledgedRevision: z.number().int().nullable(),
	/** Rows added inside the late window ("Includes 3 late expenses"); null for none, never 0. */
	lateEntries: z.number().int().min(1).nullable(),
	/** The latest change after the window, when there is one. */
	change: monthChangeSchema.nullable(),
});

export const acknowledgeMonthInputSchema = z.object({
	month: monthKeySchema,
	/** The revision the person saw; a newer one stays unacknowledged. */
	revision: z.number().int().min(1),
});

export const acknowledgeMonthResultSchema = z.object({
	month: monthKeySchema,
	acknowledgedRevision: z.number().int(),
});

// ── Welcome back (SPEC §5.5, S26) and reconcile (SPEC §5.11) ────────────────

export const accountLineSchema = z.object({
	id: idSchema,
	name: z.string(),
	/** What it holds in its own currency (a card balance counts negative). */
	worth: moneySchema,
	/** In the book currency at today's rate; null when that rate is missing. */
	value: moneySchema.nullable(),
});

export const bankSideSchema = z.object({
	/** ToAssign + Σ Left + Assigned(next): what the budget holds. */
	holds: moneySchema,
	/** Σ accounts that are part of the budget, in the book currency. */
	accounts: z.array(accountLineSchema),
	bank: moneySchema,
	/** bank - holds: what an Adjustment would record. */
	difference: moneySchema,
	/** Money people owe you: in neither side, shown apart. */
	held: moneySchema,
	reconciledAt: timestampSchema.nullable(),
	incomplete: z.boolean(),
	missingRates: z.array(missingRateSchema),
});

export const welcomeBackSchema = z.object({
	pending: z.boolean(),
	since: isoDateSchema.nullable(),
	/** Closes waiting to be read, oldest first. */
	months: z.array(
		z.object({
			month: monthKeySchema,
			revision: z.number().int(),
			acknowledged: z.boolean(),
		}),
	),
	/** "Set what I have now": the bank side as a prefill. */
	bank: bankSideSchema,
});
