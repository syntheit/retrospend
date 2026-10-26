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
 * table afterwards (src/server/services/webhooks), and so does the push
 * fan-out (src/server/services/push), which works out the other people a
 * shared write concerns from membership when it reads the event, so the
 * event itself stays in the actor's feed only: the RLS policy lets a user
 * insert rows for themselves only, and a person's feed never shows a write
 * they did not make.
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
