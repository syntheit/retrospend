import * as z from "zod";
import { v1 } from "../common/meta";

export const aiStatusSchema = z
	.object({
		currentMode: z.enum(["LOCAL", "EXTERNAL"]),
		/** Whether the external model can be used now. */
		externalAvailable: z.boolean(),
		/** Why not, when it cannot. */
		externalDeniedReason: z.string().nullable(),
		/** Requests left in the quota; null when there is none. */
		quotaRemaining: z.int().nullable(),
	})
	.meta({ id: "AiStatus" });

export const settingsExtrasContract = {
	aiStatus: v1
		.route({
			method: "GET",
			path: "/settings/ai-status",
			operationId: "getAiStatus",
			tags: ["Settings"],
			summary: "Whether AI features are available to you",
			description:
				"Your mode (settings aiMode) and whether the server lets you use the external model.",
		})
		.meta({ scope: "read" })
		.output(aiStatusSchema),
};
