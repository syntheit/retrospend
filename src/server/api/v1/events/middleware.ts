import { os } from "@orpc/server";
import { type ApiMeta, isWriteMethod } from "@retrospend/api-contract/common";
import {
	appendRouteEvent,
	type EventIntent,
	withEventIntent,
} from "~/server/services/events/scope";
import type { V1Context } from "../middleware";

/**
 * The outbox seam of /api/v1 (IMPLEMENTATION §2.2): every write route names
 * its event in `meta.event`, and this appends it. A money mutation the
 * handler runs writes the event inside its own transaction (the preview
 * runner reads the intent set here); a handler that writes some other way
 * gets the event appended right after it commits. Idempotency sits outside
 * this middleware, so a replayed request never appends a second event.
 * Previews and reads append nothing.
 */
export const recordsEvent = os
	.$context<V1Context>()
	.$meta<ApiMeta>({})
	.middleware(async ({ context, next, procedure }, input) => {
		const { meta, route } = procedure["~orpc"];
		const user = context.user;
		if (
			!meta.event ||
			meta.previewOf ||
			!user ||
			!isWriteMethod((route.method ?? "POST").toUpperCase())
		)
			return next();
		// The caller's outbox, webhooks and push devices go with the account,
		// so an event for its own deletion has no one to reach.
		if (meta.scope === "account:delete") return next();

		const intent: EventIntent = { type: meta.event, recorded: false };
		const result = await withEventIntent(intent, async () => await next());
		if (!intent.recorded)
			await appendRouteEvent(
				user.db,
				{ userId: user.principal.userId },
				meta.event,
				input,
				result.output,
			);
		return result;
	});
