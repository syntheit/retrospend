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
	/** Who made the change. */
	actorUserId: string;
	/** Who sees the event in their feed; the actor when omitted. */
	userIds?: readonly string[];
	/** The thing the write is about, by id. */
	entityId?: string | null;
	/** Ids and amounts only. Validated here, so text cannot get in. */
	data: EventData;
};

/**
 * The outbox writer (IMPLEMENTATION §2.2): appends one ApiEvent row per
 * user who should see the change. Call it with the same `tx` as the write
 * itself; a rollback then leaves no event, and a commit can never lose one.
 * Webhooks and push read the table afterwards (src/server/services/webhooks);
 * a push fan-out is the next reader (docs/ui/GAPS.md).
 *
 * Rows are written with the caller's RLS context, so each row's user must be
 * the actor or someone the actor's write affects (the policy checks the
 * actor).
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
	const userIds = [...new Set(draft.userIds ?? [draft.actorUserId])];
	await tx.apiEvent.createMany({
		data: userIds.map((userId) => ({
			userId,
			actorUserId: draft.actorUserId,
			type: draft.type,
			entityType: entityId ? draft.type.split(".")[0] : null,
			entityId,
			payload: data,
		})),
	});
}
