import * as z from "zod";
import { v1 } from "../common/meta";
import { moneySchema } from "../common/money";
import { timestampSchema } from "../core";

export const lifetimeStatsSchema = z
	.object({
		/** Everything you ever spent, in the home currency. */
		lifetimeSpend: moneySchema,
		/** Finalized entries you have added. */
		totalEntries: z.int().min(0),
		joinedAt: timestampSchema,
	})
	.meta({ id: "LifetimeStats" });

export const profileExtrasContract = {
	stats: v1
		.route({
			method: "GET",
			path: "/profile/stats",
			operationId: "getLifetimeStats",
			tags: ["Profile"],
			summary: "Lifetime totals for the profile page",
			description:
				"Needs a rate for every currency you spent in; without one the answer is missing_rate.",
		})
		.meta({ scope: "read" })
		.output(lifetimeStatsSchema),
};
