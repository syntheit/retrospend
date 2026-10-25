import * as feedback from "~/server/services/api-v1/feedback";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

export const feedbackRouter = {
	submit: v1.feedback.submit.handler(
		serve(({ context, input }) => feedback.submit(signedIn(context), input)),
	),
};
