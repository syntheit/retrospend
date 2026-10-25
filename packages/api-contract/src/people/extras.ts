import * as z from "zod";
import { v1 } from "../common/meta";
import { idSchema } from "../core";
import { participantTypeSchema } from "./schemas";

export const frequentPartnerSchema = z
	.object({
		type: participantTypeSchema,
		id: idSchema,
		name: z.string(),
		username: z.string().nullable(),
		/** Only for a person you added by name. */
		email: z.string().nullable(),
		imageUrl: z.string().nullable(),
	})
	.meta({ id: "FrequentPartner" });

export const peopleExtrasContract = {
	frequent: v1
		.route({
			method: "GET",
			path: "/people/frequent",
			operationId: "listFrequentSplitPartners",
			tags: ["People"],
			summary: "The people you split with most, for the Add sheet's quick picks",
			description:
				"At most five, most often first. People on Retrospend and people you added by name; never guests.",
		})
		.meta({ scope: "read" })
		.output(z.object({ items: z.array(frequentPartnerSchema) })),
};
