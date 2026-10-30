import * as feedback from "~/server/services/api-v1/feedback";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";
import { enforceRateLimit } from "../rate-limit";

/** Screenshot uploads per person: 5 a minute. */
const SCREENSHOT_LIMIT = { limit: 5, windowMs: 60_000 } as const;

export const feedbackRouter = {
	submit: v1.feedback.submit.handler(
		serve(({ context, input }) => feedback.submit(signedIn(context), input)),
	),
	attachScreenshot: v1.feedback.attachScreenshot.handler(
		serve(async ({ context, input }) => {
			const caller = signedIn(context);
			// Each upload is decoded and re-encoded, so it is limited per person.
			await enforceRateLimit(
				`feedback-screenshot:${caller.principal.userId}`,
				SCREENSHOT_LIMIT,
				(context as { resHeaders?: Headers }).resHeaders,
			);
			return feedback.attachScreenshot(caller, input);
		}),
	),
	submitErrorReports: v1.feedback.submitErrorReports.handler(
		serve(({ context, input }) =>
			feedback.submitErrorReports(signedIn(context), input),
		),
	),
};
