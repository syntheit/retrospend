import { kickWebhookDeliveries } from "~/server/services/webhooks/worker";

/**
 * Told after a transaction that appended events commits. The readers poll
 * (the feed) or run from a worker (webhooks), so this only wakes the worker
 * sooner. Fire and forget: a missed wake-up is caught by the next sweep.
 */
export function notifyEventsCommitted(): void {
	kickWebhookDeliveries();
}
