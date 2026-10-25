import { z } from "zod";

/** A calendar day, YYYY-MM-DD, that exists. */
const day = z.iso.date();

export const insightsRangeSchema = z
	.object({ from: day, to: day })
	.refine((range) => range.from <= range.to, {
		message: "The range must start on or before the day it ends",
		path: ["to"],
	});

/**
 * The page's Category, Person and Project chips. Ids are opaque strings: the
 * server never reads a name, only matches ids.
 */
export const insightsFilterSchema = z
	.object({
		categoryIds: z.array(z.string().min(1).max(64)).max(100).optional(),
		/** `user:<id>`, `shadow:<id>` or `guest:<id>`. */
		personKeys: z.array(z.string().min(3).max(128)).max(100).optional(),
		projectIds: z.array(z.string().min(1).max(64)).max(100).optional(),
	})
	.default({});

export const insightsSummaryInputSchema = z.object({
	range: insightsRangeSchema,
	compare: z.boolean().default(false),
	filter: insightsFilterSchema,
});

export const insightsMonthsInputSchema = z.object({
	/** The bars end at the month this day is in (or this month if that is later). */
	to: day,
	count: z.number().int().min(1).max(12).default(6),
	filter: insightsFilterSchema,
});

export const insightsYtdInputSchema = z.object({
	filter: insightsFilterSchema,
});

export const insightsCashflowInputSchema = z.object({
	range: insightsRangeSchema,
});

export type InsightsSummaryInput = z.infer<typeof insightsSummaryInputSchema>;
export type InsightsMonthsInput = z.infer<typeof insightsMonthsInputSchema>;
export type InsightsYtdInput = z.infer<typeof insightsYtdInputSchema>;
export type InsightsCashflowInput = z.infer<typeof insightsCashflowInputSchema>;
