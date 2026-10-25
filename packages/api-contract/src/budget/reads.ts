import * as z from "zod";
import { idSchema } from "../core";
import { monthKeySchema, positiveMinor, setupStyleSchema } from "./basics";
import {
	bankSideSchema,
	monthSummaryOutputSchema,
	welcomeBackSchema,
} from "./book-read";
import { owedSchema } from "./close-owed";
import { affordResultSchema, unroutedSharesOutputSchema } from "./crud-read";
import {
	interestEstimateSchema,
	payoffPlanSchema,
	payoffProjectionSchema,
	payoffStrategySchema,
} from "./debt";
import {
	envelopeExportSchema,
	envelopePacingSchema,
	hiddenRowsOutputSchema,
	migrationStateSchema,
} from "./migration";
import { leftToSpendSchema, verdictSchema } from "./month";
import {
	draftKindSchema,
	draftPreviewSchema,
	draftsOutputSchema,
	planFillOutputSchema,
} from "./plan-drafts";
import { incomeRuleSchema } from "./plan-rules";
import { planCostSchema, yearViewSchema } from "./plan-year";
import {
	coverSourceSchema,
	fillFromTargetsOutputSchema,
	getMonthOutputSchema,
	historyOutputSchema,
	setupPresetOutputSchema,
} from "./read";
import { budgetRead, budgetReadAll } from "./routes";

/**
 * Query strings carry text, so numbers are coerced and lists are comma
 * separated. Each query is the matching tRPC input, written for a GET.
 */
const monthParam = z.coerce.number().pipe(monthKeySchema);
const amountParam = z.coerce.number().pipe(positiveMinor);
const idList = z
	.string()
	.max(4000)
	.transform((v) => v.split(",").filter((x) => x.length > 0))
	.pipe(z.array(idSchema).max(200));

export const monthQuerySchema = z.object({
	month: monthParam
		.optional()
		.meta({ description: "YYYYMM; the current month when omitted." }),
});

export const setupPresetQuerySchema = z.object({ style: setupStyleSchema });

export const fillQuerySchema = z.object({
	month: monthParam.optional(),
	amountMinor: amountParam
		.optional()
		.meta({ description: "Plan only this much; default: all of To assign." }),
});

export const coverSourcesQuerySchema = z.object({
	envelopeId: idSchema,
	month: monthParam.optional(),
});

export const historyQuerySchema = z.object({
	month: monthParam.optional(),
	envelopeId: idSchema.optional(),
	cursor: idSchema
		.optional()
		.meta({ description: "The nextCursor of the previous page." }),
	limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const monthRequiredQuerySchema = z.object({ month: monthParam });

export const affordQuerySchema = z.object({
	month: monthParam.optional(),
	amountMinor: amountParam,
	envelopeId: idSchema.optional(),
});

export const unroutedQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const draftsQuerySchema = z.object({
	kind: draftKindSchema,
	month: monthParam.optional(),
});

export const draftIdParamsSchema = z.object({ draftId: idSchema });

export const planFillQuerySchema = z.object({
	source: z.enum(["TARGETS", "SAME_AS_THIS_MONTH", "THIS_MONTH_SPENT"]),
});

export const planCostQuerySchema = z.object({
	month: monthParam.optional(),
	essentialIds: idList
		.optional()
		.meta({
			description: "Comma-separated envelope ids counted as essential.",
		}),
});

export const yearQuerySchema = z.object({
	year: z.coerce.number().int().min(1900).max(2999).optional(),
});

export const payoffProjectionQuerySchema = z.object({
	strategy: payoffStrategySchema.optional(),
	extraMonthlyMinor: z.coerce.number().int().min(0).optional(),
	customOrder: idList
		.optional()
		.meta({ description: "Comma-separated liability ids." }),
});

export const liabilityParamsSchema = z.object({ liabilityId: idSchema });

/** Why a read answers null: there is no budget yet (the person chose Just track). */
const NO_BOOK = "Null when there is no budget yet.";

export const budgetReads = {
	setupPreset: budgetRead({
		path: "/budget/setup-preset",
		operationId: "getBudgetSetupPreset",
		summary: "What a budget style proposes",
		input: setupPresetQuerySchema,
		output: setupPresetOutputSchema,
	}),
	month: budgetRead({
		path: "/budget/month",
		operationId: "getBudgetMonth",
		summary: "A month of the budget",
		description: `Groups, envelopes with Assigned, Activity and Left, To assign, the verdict and Owed. ${NO_BOOK}`,
		input: monthQuerySchema,
		output: getMonthOutputSchema.nullable(),
	}),
	verdict: budgetRead({
		path: "/budget/verdict",
		operationId: "getBudgetVerdict",
		summary: "The one number and sentence at the top of Budget",
		description: NO_BOOK,
		input: monthQuerySchema,
		output: verdictSchema.nullable(),
	}),
	leftToSpend: budgetRead({
		path: "/budget/left-to-spend",
		operationId: "getBudgetLeftToSpend",
		summary: "Left to spend and what it is made of",
		description: NO_BOOK,
		input: monthQuerySchema,
		output: leftToSpendSchema.nullable(),
	}),
	fillFromTargets: budgetRead({
		path: "/budget/fill-from-targets",
		operationId: "getBudgetFillFromTargets",
		summary: "What Use my plan would assign",
		input: fillQuerySchema,
		output: fillFromTargetsOutputSchema,
	}),
	coverSources: budgetRead({
		path: "/budget/cover-sources",
		operationId: "getBudgetCoverSources",
		summary: "Where money to cover an envelope can come from",
		input: coverSourcesQuerySchema,
		output: z.array(coverSourceSchema),
	}),
	history: budgetRead({
		path: "/budget/history",
		operationId: "listBudgetMovements",
		summary: "Money movements, newest first",
		input: historyQuerySchema,
		output: historyOutputSchema,
	}),
	owed: budgetReadAll({
		path: "/budget/owed",
		operationId: "getBudgetOwed",
		summary: "Money owed to you per person and currency",
		description: NO_BOOK,
		output: owedSchema.nullable(),
	}),
	monthSummary: budgetRead({
		path: "/budget/month-summary",
		operationId: "getBudgetMonthSummary",
		summary: "A closed month's summary",
		description: "Null until the month closes.",
		input: monthRequiredQuerySchema,
		output: monthSummaryOutputSchema.nullable(),
	}),
	welcomeBackState: budgetReadAll({
		path: "/budget/welcome-back",
		operationId: "getBudgetWelcomeBack",
		summary: "Whether Welcome back is waiting, with the bank side as a prefill",
		output: welcomeBackSchema,
	}),
	bankCheck: budgetReadAll({
		path: "/budget/bank-check",
		operationId: "getBudgetBankCheck",
		summary: "Does this match your bank?",
		output: bankSideSchema,
	}),
	afford: budgetRead({
		path: "/budget/afford",
		operationId: "getBudgetAfford",
		summary: "Can I afford it? One amount, one answer",
		description: `Writes nothing. ${NO_BOOK}`,
		input: affordQuerySchema,
		output: affordResultSchema.nullable(),
	}),
	unroutedShares: budgetRead({
		path: "/budget/unrouted-shares",
		operationId: "listBudgetUnroutedShares",
		summary: "Shares that found no envelope",
		description: `They sit in Everything else until you pick. ${NO_BOOK}`,
		input: unroutedQuerySchema,
		output: unroutedSharesOutputSchema.nullable(),
	}),
	rules: budgetReadAll({
		path: "/budget/rules",
		operationId: "listBudgetRules",
		summary: "Income rules, in the order they run",
		output: z.array(incomeRuleSchema),
	}),
	drafts: budgetRead({
		path: "/budget/drafts",
		operationId: "getBudgetDrafts",
		summary: "The open draft and the saved plan of a month",
		input: draftsQuerySchema,
		output: draftsOutputSchema,
	}),
	draftOutcome: budgetRead({
		path: "/budget/drafts/{draftId}/outcome",
		operationId: "getBudgetDraftOutcome",
		summary: "What a draft would do",
		description: "Never writes.",
		input: draftIdParamsSchema,
		output: draftPreviewSchema,
	}),
	planFill: budgetRead({
		path: "/budget/plan-fill",
		operationId: "getBudgetPlanFill",
		summary: "Lines to start a plan from",
		input: planFillQuerySchema,
		output: planFillOutputSchema,
	}),
	planCost: budgetRead({
		path: "/budget/plan-cost",
		operationId: "getBudgetPlanCost",
		summary: "What the plan costs, typical income and runway",
		input: planCostQuerySchema,
		output: planCostSchema,
	}),
	year: budgetRead({
		path: "/budget/year",
		operationId: "getBudgetYear",
		summary: "Assigned, spent and left per envelope and month",
		input: yearQuerySchema,
		output: yearViewSchema,
	}),
	payoffPlan: budgetReadAll({
		path: "/budget/payoff-plan",
		operationId: "getBudgetPayoffPlan",
		summary: "The saved debt payoff plan",
		output: payoffPlanSchema,
	}),
	payoffProjection: budgetRead({
		path: "/budget/payoff-projection",
		operationId: "getBudgetPayoffProjection",
		summary: "Debt-free month, total interest and payoff month per debt",
		description: "Never writes. Query values replace the saved plan's.",
		input: payoffProjectionQuerySchema,
		output: payoffProjectionSchema,
	}),
	interestEstimate: budgetRead({
		path: "/budget/debts/{liabilityId}/interest-estimate",
		operationId: "getBudgetInterestEstimate",
		summary: "Interest a debt payment is expected to carry",
		input: liabilityParamsSchema,
		output: interestEstimateSchema,
	}),
	migration: budgetReadAll({
		path: "/budget/migration",
		operationId: "getBudgetMigration",
		summary: "The move from the old budget: notice and hidden rows",
		output: migrationStateSchema,
	}),
	hiddenRows: budgetReadAll({
		path: "/budget/hidden-rows",
		operationId: "listBudgetHiddenRows",
		summary: "Rows the move left out until you answer",
		output: hiddenRowsOutputSchema,
	}),
	export: budgetReadAll({
		path: "/budget/export",
		operationId: "exportBudget",
		summary: "Envelopes, movements, rules and months as files",
		output: envelopeExportSchema,
	}),
	pacing: budgetReadAll({
		path: "/budget/pacing",
		operationId: "getBudgetPacing",
		summary: "Budget and spent against the days left",
		description: NO_BOOK,
		output: envelopePacingSchema.nullable(),
	}),
};
