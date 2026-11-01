/**
 * Contract for the Budget page's insights: how a month's spending compares
 * with what was planned, which envelopes are furthest over or have the most
 * room, and how spending moved over the last months. Computed on the server
 * from the same month reads the page shows (R9); the client only formats.
 */
import { z } from "zod";
import { moneySchema, monthKeySchema } from "./envelope";

const idSchema = z.string().min(1).max(64);

export const insightsInputSchema = z.object({
	month: monthKeySchema.optional(),
});

/** Spent of planned, in hundredths of a percent, capped at 100%; over says it went past. */
const basisSchema = z.number().int().min(0).max(10_000);

export const budgetInsightsSchema = z.object({
	month: monthKeySchema,
	/** What the month planned for envelopes that spend (carried in plus assigned). */
	planned: moneySchema,
	/** What those envelopes spent. */
	spent: moneySchema,
	basis: basisSchema.nullable(),
	/** Spent more than planned in total. */
	over: z.boolean(),
	/** Envelopes furthest over what they hold, most first (at most 3). */
	mostOver: z.array(
		z.object({ id: idSchema, name: z.string(), over: moneySchema }),
	),
	/** Envelopes with the most left (at most 3). */
	mostRoom: z.array(
		z.object({
			id: idSchema,
			name: z.string(),
			left: moneySchema,
			basis: basisSchema.nullable(),
		}),
	),
	/** Spent per month, oldest first, ending with this one; empty before a second month exists. */
	trend: z.array(z.object({ month: monthKeySchema, spent: moneySchema })),
	/** Some rows have no rate yet, so the totals leave them out. */
	incomplete: z.boolean(),
});

export type BudgetInsights = z.infer<typeof budgetInsightsSchema>;
export type InsightsInput = z.infer<typeof insightsInputSchema>;
