import { readEventFeed } from "~/server/services/events/feed";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

export const eventsRouter = {
	list: v1.events.list.handler(
		serve(({ context, input }) => {
			const user = signedIn(context);
			return readEventFeed(user.db, user.principal.userId, input);
		}),
	),
};
