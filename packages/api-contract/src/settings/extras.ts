import * as z from "zod";
import { v1 } from "../common/meta";

export const aiStatusSchema = z
	.object({
		currentMode: z.enum(["LOCAL", "EXTERNAL"]),
		/** Whether you turned AI import on (settings aiImportEnabled). */
		importEnabled: z.boolean(),
		/** The provider that would read an import file for you. */
		provider: z.enum(["OPENROUTER", "OLLAMA"]),
		/** Its model, when the server knows it. */
		model: z.string().nullable(),
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
				"Your mode (settings aiMode), whether AI import is on for you, which provider and model would read a file, and whether the server lets you use the external model.",
		})
		.meta({ scope: "read" })
		.output(aiStatusSchema),
};
