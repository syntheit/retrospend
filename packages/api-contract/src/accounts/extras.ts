import * as z from "zod";
import { v1 } from "../common/meta";
import { currencyCodeSchema, moneySchema } from "../common/money";

export const runwayQuerySchema = z.object({
	currency: currencyCodeSchema.optional().meta({
		description: "The currency of the answer. Left out: your home currency.",
	}),
});

export const runwaySchema = z
	.object({
		/** Average spending per month over up to the last six months. */
		averageMonthlySpend: moneySchema,
		/** How many months that average covers, 1 to 6. */
		monthsActive: z.int().min(1).max(6),
	})
	.meta({ id: "Runway" });

export const accountsExtrasContract = {
	runway: v1
		.route({
			method: "GET",
			path: "/accounts/runway",
			operationId: "getRunway",
			tags: ["Accounts"],
			summary: "How fast the money goes: average monthly spending",
			description:
				"Divide what you hold by it to see how long it lasts. Needs a rate for every currency you spent in; without one the answer is missing_rate.",
		})
		.meta({ scope: "read" })
		.input(runwayQuerySchema)
		.output(runwaySchema),
};
