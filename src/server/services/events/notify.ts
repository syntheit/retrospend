import { db } from "~/server/db";
import { kickWebhookDeliveries } from "~/server/services/webhooks/worker";

/**
 * Told after a transaction that appended an event for `userId` commits. The
 * readers poll (the feed) or run from a worker (webhooks), so this only
 * wakes the worker sooner, and only when the user has a webhook to serve:
 * most writes belong to people who have none. Fire and forget: a missed
 * wake-up is caught by the worker's own timer.
 */
export function notifyEventsCommitted(actor: { userId: string }): void {
	void db.webhook
		.count({ where: { userId: actor.userId, enabled: true } })
		.then((count) => {
			if (count > 0) kickWebhookDeliveries();
		})
		.catch(() => undefined);
}
