import { readEventFeed } from "~/server/services/events/feed";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";
import { mayCall } from "../scopes";

export const eventsRouter = {
	list: v1.events.list.handler(
		serve(({ context, input }) => {
			const { db, principal } = signedIn(context);
			return readEventFeed(db, principal.userId, input, {
				// Decided here, from the principal's scopes: a token, an API key or a
				// device session never holds `vault`, so it never sees the wake-up.
				includeVault: mayCall(principal, "vault"),
				protectedAccount: principal.protected,
			});
		}),
	),
};
