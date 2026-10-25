import { readNeedsYou } from "~/server/services/api-v1/home";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

export const needsYouRouter = {
	list: v1["needs-you"].list.handler(
		serve(({ context }) => readNeedsYou(signedIn(context))),
	),
};
