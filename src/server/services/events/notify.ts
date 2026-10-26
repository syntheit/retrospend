import { db } from "~/server/db";
import { kickPushDeliveries } from "~/server/services/push/worker";
import { kickWebhookDeliveries } from "~/server/services/webhooks/worker";

/**
 * Told after a transaction that appended an event for `userId` commits. The
 * readers poll (the feed) or run from workers (webhooks, push), so this only
 * wakes the workers sooner. The webhook worker is woken only when the user
 * has a webhook to serve: most writes belong to people who have none. The
 * push worker is woken on every commit, because a write reaches the other
 * people on it; it returns at once when no push sender is configured. Fire
 * and forget: a missed wake-up is caught by each worker's own timer.
 */
export function notifyEventsCommitted(actor: { userId: string }): void {
	kickPushDeliveries();
	void db.webhook
		.count({ where: { userId: actor.userId, enabled: true } })
		.then((count) => {
			if (count > 0) kickWebhookDeliveries();
		})
		.catch(() => undefined);
}
