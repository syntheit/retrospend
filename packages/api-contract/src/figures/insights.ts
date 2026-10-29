import * as z from "zod";
import { v1 } from "../common/meta";
import { currencyCodeSchema, moneySchema } from "../common/money";
import { daySchema } from "../ledger";

/**
 * Insights (GET /figures/insights/*): the web's Insights reads, one route
 * each. They send facts only: ids, Money and whole-percent changes. A
 * `value` of null means a missing rate keeps the number out, never zero.
 * Category names and colors are the client's (GET /categories).
 */

const COMMA_LIST = /^[^,]+(,[^,]+)*$/;

const listParam = (what: string, example: string) =>
	z
		.string()
		.max(4000)
		.regex(COMMA_LIST)
		.optional()
		.meta({ description: `Comma-separated ${what}.`, examples: [example] });

/** The page's Category, Person and Project chips, in the /expenses filter's words. */
const filterParams = {
	cat: listParam("category ids", "c1,c2"),
	person: listParam("person keys (user:ID, shadow:ID, guest:ID)", "user:u1"),
	project: listParam("project ids", "p1"),
};

const spanSchema = z.object({ from: daySchema, to: daySchema });

const insightsFigureSchema = z
	.object({ id: z.string(), value: moneySchema.nullable() })
	.meta({ id: "InsightsFigure" });

const homeAndUsdSchema = z.object({
	home: moneySchema.nullable(),
	usd: moneySchema.nullable(),
});

export const insightsSummarySchema = z
	.object({
		home: currencyCodeSchema,
		range: spanSchema,
		/** Null without compare. */
		previousRange: spanSchema.nullable(),
		total: insightsFigureSchema,
		previousTotal: insightsFigureSchema.nullable(),
		/** Whole percent, signed; null reads "new". */
		changePct: z.int().nullable(),
		/** Expenses behind the total. */
		count: z.int(),
		/** Largest first; categories that net to nothing or less are left out. */
		categories: z.array(
			z.object({
				/** Null: spending with no category. */
				categoryId: z.string().nullable(),
				/** The row's figure is `figure` narrowed by `categoryId`. */
				figure: z.string(),
				value: moneySchema.nullable(),
				previous: moneySchema.nullable(),
				changePct: z.int().nullable(),
			}),
		),
		missingRates: z.array(currencyCodeSchema),
	})
	.meta({ id: "InsightsSummary" });

export const insightsMonthsSchema = z
	.object({
		home: currencyCodeSchema,
		/** Oldest first, ending at the month of `to` (or this month if sooner). */
		months: z.array(
			z.object({
				/** The fiscal month's label, 2026-10. */
				month: z.string().regex(/^\d{4}-\d{2}$/),
				span: spanSchema,
				figure: z.string(),
				total: moneySchema.nullable(),
			}),
		),
		missingRates: z.array(currencyCodeSchema),
	})
	.meta({ id: "InsightsMonths" });

export const insightsYtdSchema = z
	.object({
		home: currencyCodeSchema,
		thisYear: spanSchema,
		lastYear: spanSchema,
		total: z.object({
			home: insightsFigureSchema,
			usd: insightsFigureSchema,
			changePct: z.int().nullable(),
			usdChangePct: z.int().nullable(),
		}),
		lastYearTotal: z.object({
			home: insightsFigureSchema,
			usd: insightsFigureSchema,
		}),
		/** In home order, largest first. */
		categories: z.array(
			z.object({
				categoryId: z.string().nullable(),
				figure: z.string(),
				usdFigure: z.string(),
				value: homeAndUsdSchema,
				lastYear: homeAndUsdSchema,
				/** Place by USD value, largest first, from 0. */
				usdRank: z.int(),
				changePct: z.int().nullable(),
				usdChangePct: z.int().nullable(),
			}),
		),
		missingRates: z.array(currencyCodeSchema),
	})
	.meta({ id: "InsightsYtd" });

export const insightsCashflowSchema = z
	.object({
		home: currencyCodeSchema,
		range: spanSchema,
		income: insightsFigureSchema,
		/** Income minus spending, signed. */
		saved: insightsFigureSchema,
		/** Whole percent of income left; null without income or with a figure missing. */
		savingsRatePct: z.int().nullable(),
		dailyAverage: insightsFigureSchema,
		monthlyAverage: insightsFigureSchema,
		missingRates: z.array(currencyCodeSchema),
	})
	.meta({ id: "InsightsCashflow" });

export const insightsSummaryQuerySchema = z.object({
	from: daySchema,
	to: daySchema,
	/** Adds the period before, and each category's change against it. */
	compare: z.enum(["true", "false"]).optional(),
	...filterParams,
});

export const insightsMonthsQuerySchema = z.object({
	/** The bars end at the month this day is in (or this month if that is later). */
	to: daySchema,
	count: z.coerce.number().int().min(1).max(12).default(6),
	...filterParams,
});

export const insightsYtdQuerySchema = z.object(filterParams);

export const insightsCashflowQuerySchema = z.object({
	from: daySchema,
	to: daySchema,
});

const TAGS = ["Figures"];

export const figuresInsightsContract = {
	insightsSummary: v1
		.route({
			method: "GET",
			path: "/figures/insights/summary",
			operationId: "getInsightsSummary",
			tags: TAGS,
			summary: "Insights: your spending over a range, by category",
			description:
				"The total, the count and the categories (largest first) for from to to, both inclusive. With compare=true, the period before (the fiscal period before a fiscal period, the month before a whole month, else as many days right before) and each category's change.",
		})
		.meta({ scope: "read" })
		.input(insightsSummaryQuerySchema)
		.output(insightsSummarySchema),
	insightsMonths: v1
		.route({
			method: "GET",
			path: "/figures/insights/months",
			operationId: "getInsightsMonths",
			tags: TAGS,
			summary: "Insights: spending month by month",
		})
		.meta({ scope: "read" })
		.input(insightsMonthsQuerySchema)
		.output(insightsMonthsSchema),
	insightsYtd: v1
		.route({
			method: "GET",
			path: "/figures/insights/ytd",
			operationId: "getInsightsYtd",
			tags: TAGS,
			summary: "Insights: year to date against the same span last year",
			description:
				"In the home currency and in USD at the value each expense was saved with, by category.",
		})
		.meta({ scope: "read" })
		.input(insightsYtdQuerySchema)
		.output(insightsYtdSchema),
	insightsCashflow: v1
		.route({
			method: "GET",
			path: "/figures/insights/cashflow",
			operationId: "getInsightsCashflow",
			tags: TAGS,
			summary: "Insights: income, saved and the averages for a range",
			description:
				"Ignores category, person and project: income has no category.",
		})
		.meta({ scope: "read" })
		.input(insightsCashflowQuerySchema)
		.output(insightsCashflowSchema),
};
