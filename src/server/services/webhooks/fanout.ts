import { db } from "~/server/db";
import {
	type AudienceEvent,
	copyToOtherParties,
} from "~/server/services/events/audience";
import type { Prisma } from "~prisma";

/**
 * The webhook fan-out: turns new outbox events into one delivery per
 * matching webhook, and copies events about shared things into the other
 * people's feeds (events/audience.ts). Safe to run from several processes at
 * once: only events whose transaction is behind the oldest open one are
 * taken, and `FOR UPDATE SKIP LOCKED` lets two workers split a batch.
 */

export const FAN_OUT_BATCH = 200;
/**
 * A batch of shared events reads the people on each of them: more time than
 * Prisma's default five seconds, or a slow database would roll the batch back
 * for good.
 */
const FAN_OUT_TIMEOUT_MS = 30_000;
/** `[]` matches everything; an entry is a full type or `<resource>.*`. */
export function matchesEventFilter(filter: readonly string[], type: string) {
	if (filter.length === 0) return true;
	const resource = type.split(".")[0];
	return filter.some((f) => f === type || f === `${resource}.*`);
}

type OutboxRow = AudienceEvent;

/** Turns new events into deliveries. Returns how many events it handled. */
export async function fanOutEvents(): Promise<number> {
	return db.$transaction(
		async (tx) => {
			// Only events whose transaction is behind the oldest open one, so a
			// late commit is not missed; SKIP LOCKED lets two workers split a batch.
			const events = await tx.$queryRaw<OutboxRow[]>`
			SELECT "id", "userId", "actorUserId", "type", "entityId", "payload",
			       "createdAt", "sourceEventId" FROM "api_event"
			WHERE "fannedOutAt" IS NULL
			  AND "txid" < pg_snapshot_xmin(pg_current_snapshot())
			ORDER BY "txid", "seq"
			LIMIT ${FAN_OUT_BATCH}
			FOR UPDATE SKIP LOCKED`;
			if (events.length === 0) return 0;

			const deliverable = events.filter((e) => !e.type.startsWith("webhook."));
			const hooks = await tx.webhook.findMany({
				where: {
					enabled: true,
					userId: { in: [...new Set(deliverable.map((e) => e.userId))] },
				},
			});
			const now = new Date();
			const rows: Prisma.WebhookDeliveryCreateManyInput[] = [];
			for (const event of deliverable)
				for (const hook of hooks) {
					if (
						hook.userId === event.userId &&
						hook.createdAt <= event.createdAt &&
						matchesEventFilter(hook.eventTypes, event.type)
					)
						rows.push({
							webhookId: hook.id,
							userId: hook.userId,
							eventId: event.id,
							eventType: event.type,
							nextAttemptAt: now,
						});
				}
			await tx.webhookDelivery.createMany({ data: rows, skipDuplicates: true });
			// The others on a shared thing get the event in their own feeds; the
			// copies are fanned out to their webhooks on a later pass.
			await copyToOtherParties(tx, events, now);
			await tx.apiEvent.updateMany({
				where: { id: { in: events.map((e) => e.id) } },
				data: { fannedOutAt: now },
			});
			return events.length;
		},
		{ timeout: FAN_OUT_TIMEOUT_MS },
	);
}
