import * as z from "zod";
import { v1 } from "../common/meta";
import { daySchema } from "../ledger";

export const figuresExtrasContract = {
	firstDay: v1
		.route({
			method: "GET",
			path: "/figures/first-day",
			operationId: "getInsightsFirstDay",
			tags: ["Figures"],
			summary: "The day of your oldest spending: where All time starts",
		})
		.meta({ scope: "read" })
		.output(z.object({ day: daySchema.nullable() })),
};
