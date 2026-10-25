import * as z from "zod";
import { v1 } from "../common/meta";
import { userText } from "../common/user-text";
import { okSchema } from "../core";

export const submitFeedbackSchema = z
	.object({
		message: userText("feedback.message", 5000),
		/** The screen it was written on. */
		pageUrl: z.string().max(2048),
		userAgent: z.string().max(512).optional(),
		viewportSize: z.string().max(32).optional(),
		appVersion: z.string().max(32).optional(),
	})
	.meta({ id: "SubmitFeedback" });

export type SubmitFeedback = z.infer<typeof submitFeedbackSchema>;

/**
 * Feedback goes to the server's admins. Reading it is an admin route
 * (GET /admin/feedback); a user can only send. Five entries per hour.
 */
export const feedbackContract = {
	submit: v1
		.route({
			method: "POST",
			path: "/feedback",
			operationId: "submitFeedback",
			tags: ["Feedback"],
			summary: "Send feedback to the admins",
			description:
				"Answers 409 after 5 entries in an hour. Admins are emailed when the server has email on.",
			successStatus: 201,
		})
		.meta({ scope: "write:settings", event: "feedback.submitted" })
		.input(submitFeedbackSchema)
		.output(okSchema),
};
