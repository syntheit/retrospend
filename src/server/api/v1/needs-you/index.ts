import * as gap from "~/server/services/api-v1/gap-reads";
import { readNeedsYou } from "~/server/services/api-v1/home";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

export const needsYouRouter = {
	snooze: v1["needs-you"].snooze.handler(
		serve(({ context, input }) => gap.snoozeItem(signedIn(context), input)),
	),
	unsnooze: v1["needs-you"].unsnooze.handler(
		serve(({ context, input }) =>
			gap.unsnoozeItem(signedIn(context), input.itemId),
		),
	),
	list: v1["needs-you"].list.handler(
		serve(({ context }) => readNeedsYou(signedIn(context))),
	),
};
