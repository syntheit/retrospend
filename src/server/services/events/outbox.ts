import {
	EVENT_ID_PATTERN,
	type EventData,
	eventDataSchema,
	isEventTypeName,
} from "@retrospend/api-contract";
import type { Prisma } from "~prisma";

/** What appendEvent needs: the `tx` of the write, so the event commits or rolls back with it. */
export type EventWriter = Pick<Prisma.TransactionClient, "apiEvent">;

export type EventDraft = {
	/** `<resource>.<verb>`, registered in EVENT_TYPES. */
	type: string;
	/** Who made the change, and the only feed that gets the event. */
	actorUserId: string;
	/** The thing the write is about, by id. */
	entityId?: string | null;
	/** Ids and amounts only. Validated here, so text cannot get in. */
	data: EventData;
};

/**
 * The outbox writer (IMPLEMENTATION §2.2): appends one ApiEvent to the
 * actor's feed. Call it with the same `tx` as the write itself; a rollback
 * then leaves no event, and a commit can never lose one. Webhooks read the
 * table afterwards (src/server/services/webhooks); a push fan-out is the next
 * reader (docs/ui/GAPS.md).
 *
 * Follow-up: a shared write (a payment, a shared expense) should also reach
 * the other people involved. That needs recipients computed from membership
 * and a row written outside the actor's RLS context; until then the RLS
 * policy lets a user insert only rows for themselves, so no write can put an
 * event into someone else's feed.
 */
export async function appendEvent(
	tx: EventWriter,
	draft: EventDraft,
): Promise<void> {
	if (!isEventTypeName(draft.type))
		throw new Error(`"${draft.type}" is not an event type name`);
	const data = eventDataSchema.parse(draft.data);
	const entityId =
		draft.entityId && EVENT_ID_PATTERN.test(draft.entityId)
			? draft.entityId
			: null;
	await tx.apiEvent.create({
		data: {
			userId: draft.actorUserId,
			actorUserId: draft.actorUserId,
			type: draft.type,
			entityType: entityId ? draft.type.split(".")[0] : null,
			entityId,
			payload: data,
		},
		select: { id: true },
	});
}
