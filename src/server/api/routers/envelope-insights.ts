/**
 * The Budget page's insights, merged flat into the envelope router
 * (envelope.insights). A read: spending against the plan, the envelopes
 * furthest over and with the most room, and the last months' spending.
 */
import {
	budgetInsightsSchema,
	insightsInputSchema,
} from "~/lib/schemas/envelope-insights";
import { getBudgetInsights } from "~/server/services/envelope/insights.service";
import { envelopeProcedure } from "./envelope-procedure";

export const envelopeInsightsProcedures = {
	/** Null: no budget yet. */
	insights: envelopeProcedure
		.input(insightsInputSchema)
		.output(budgetInsightsSchema.nullable())
		.query(({ ctx, input }) =>
			getBudgetInsights(
				ctx.session.user.id,
				input.month,
				new Date(),
				ctx.timeZone ?? null,
			),
		),
};
