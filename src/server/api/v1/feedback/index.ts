import * as feedback from "~/server/services/api-v1/feedback";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

export const feedbackRouter = {
	submit: v1.feedback.submit.handler(
		serve(({ context, input }) => feedback.submit(signedIn(context), input)),
	),
	attachScreenshot: v1.feedback.attachScreenshot.handler(
		serve(({ context, input }) =>
			feedback.attachScreenshot(signedIn(context), input),
		),
	),
	submitErrorReports: v1.feedback.submitErrorReports.handler(
		serve(({ context, input }) =>
			feedback.submitErrorReports(signedIn(context), input),
		),
	),
};
