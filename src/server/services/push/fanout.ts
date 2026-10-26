import { db } from "~/server/db";
import { eventEntityId } from "~/server/services/events/audience";
import type { PushConfig } from "./config";
import { enqueuePushes, type PushDraft } from "./enqueue";
import { pushKindOf } from "./kinds";
import { newPushData } from "./message";
import { planPush } from "./recipients";

/**
 * Reads new outbox events and queues a delivery per recipient device. Like
 * the webhook fan-out it only takes events whose transaction is behind the
 * oldest open one (a late commit is never missed), and `FOR UPDATE SKIP
 * LOCKED` lets two workers split a batch. `pushedAt` marks an event as
 * looked at, whether or not it found anybody.
 *
 * Events older than STALE_MS are marked and not pushed: after a long
 * outage, or the first time push is switched on, a person should not get an
 * hour-old burst.
 */

export const FAN_OUT_BATCH = 200;
export const STALE_MS = 60 * 60 * 1000;
const TRANSACTION_TIMEOUT_MS = 30_000;

type OutboxRow = {
	id: string;
	userId: string;
	actorUserId: string | null;
	type: string;
	entityId: string | null;
	payload: unknown;
	createdAt: Date;
};

/** Returns how many events it handled. */
export async function fanOutPushEvents(
	config: PushConfig,
	now = new Date(),
): Promise<number> {
	return db.$transaction(
		async (tx) => {
			const events = await tx.$queryRaw<OutboxRow[]>`
				SELECT "id", "userId", "actorUserId", "type", "entityId", "payload", "createdAt"
				FROM "api_event"
				WHERE "pushedAt" IS NULL
				  AND "txid" < pg_snapshot_xmin(pg_current_snapshot())
				ORDER BY "txid", "seq"
				LIMIT ${FAN_OUT_BATCH}
				FOR UPDATE SKIP LOCKED`;
			if (events.length === 0) return 0;

			const drafts: PushDraft[] = [];
			for (const event of events) {
				const type = pushKindOf(event.type);
				const entityId = type && eventEntityId(event);
				if (
					!type ||
					!entityId ||
					now.getTime() - event.createdAt.getTime() > STALE_MS
				)
					continue;
				const plan = await planPush(tx, {
					type,
					actorUserId: event.actorUserId ?? event.userId,
					entityId,
				});
				for (const recipient of plan?.recipients ?? [])
					drafts.push({
						userId: recipient.userId,
						eventId: event.id,
						dedupeKey: `event:${event.id}`,
						data: newPushData(type, {
							entity: plan?.entity,
							ids: plan?.ids,
							amount: recipient.amount,
						}),
					});
			}
			await enqueuePushes(tx, config, drafts, now);
			await tx.apiEvent.updateMany({
				where: { id: { in: events.map((e) => e.id) } },
				data: { pushedAt: now },
			});
			return events.length;
		},
		{ timeout: TRANSACTION_TIMEOUT_MS },
	);
}
