import { type EventData, eventDataSchema } from "@retrospend/api-contract";
import {
	otherParties,
	type PartiesReader,
	usersOfPeople,
} from "~/server/services/push/recipients";
import type { Prisma } from "~prisma";
import { toldPeople } from "./data";

/**
 * Who else sees an event. An event is written into the feed of the person
 * who made the change. When the change is to something that people share (a
 * split expense, a fix request, a payment), the others on it have a stake in
 * it too: their `GET /events` and their webhooks should say "something
 * changed on a thing you are on". The webhook fan-out calls this for each
 * event it handles and writes one copy per other person.
 *
 * A copy is the other person's own row. It names the type, the entity and
 * the actor, and carries no ids and no amounts: the actor's figures, their
 * category and their account are the actor's business, and the reader gets
 * the entity itself through the API like anything else they can see. It is
 * marked as pushed, because the push fan-out tells the same people from the
 * original, and it is never copied again (`sourceEventId`). The other
 * people come from membership as it is now, read from the entity the event
 * names, and an event whose actor has no part in that entity reaches
 * nobody, so a forged entity id cannot aim an event at strangers.
 *
 * A deleted expense has nothing left to read the people from, so its delete
 * names them in the event's ids when it is written (`tell.user.0`, see
 * data.ts), and those people get the copy. Only the types in TELL_TYPES
 * honor those names.
 */

/** The resources whose events are copied to the others on them. */
const SHARED_RESOURCES: ReadonlySet<string> = new Set([
	"shared_expense",
	"fix_request",
	"payment",
]);

/** Events about a thing that is gone, whose ids name the people to tell. */
const TELL_TYPES: ReadonlySet<string> = new Set(["shared_expense.deleted"]);

export type AudienceEvent = {
	id: string;
	userId: string;
	actorUserId: string | null;
	type: string;
	entityId: string | null;
	payload: unknown;
	createdAt: Date;
	sourceEventId: string | null;
};

const NOTHING: EventData = { ids: {}, amounts: [], truncated: false };

/**
 * The entity an event is about. Most writes name it as the event's entity;
 * a payment's result calls it `paymentId`, so it arrives in the ids.
 */
export function eventEntityId(event: {
	type: string;
	entityId: string | null;
	payload: unknown;
}): string | null {
	if (event.entityId) return event.entityId;
	if (!event.type.startsWith("payment.")) return null;
	const parsed = eventDataSchema.safeParse(event.payload);
	return parsed.success ? (parsed.data.ids.paymentId ?? null) : null;
}

function namedPeople(payload: unknown) {
	const parsed = eventDataSchema.safeParse(payload);
	return parsed.success ? toldPeople(parsed.data.ids) : [];
}

/** The ids that are still accounts: a named person may have left since the delete. */
async function stillHere(
	tx: Pick<AudienceWriter, "user">,
	userIds: string[],
): Promise<string[]> {
	if (userIds.length === 0) return [];
	const rows = await tx.user.findMany({
		where: { id: { in: userIds } },
		select: { id: true },
	});
	return rows.map((r) => r.id);
}

export type AudienceWriter = PartiesReader & {
	user: Pick<Prisma.TransactionClient["user"], "findMany">;
	apiEvent: Pick<Prisma.TransactionClient["apiEvent"], "createMany">;
};

/** Writes the copies for `events`. Returns how many it wrote. */
export async function copyToOtherParties(
	tx: AudienceWriter,
	events: readonly AudienceEvent[],
	now: Date,
): Promise<number> {
	const rows: Prisma.ApiEventCreateManyInput[] = [];
	for (const event of events) {
		const resource = event.type.split(".")[0] ?? "";
		const entityId = eventEntityId(event);
		// A copy is never copied, only shared things have other people, and
		// only the actor's own row is a change to tell about (a row that
		// names someone else as the actor is not one the app writes).
		if (
			event.sourceEventId ||
			!entityId ||
			!SHARED_RESOURCES.has(resource) ||
			(event.actorUserId !== null && event.actorUserId !== event.userId)
		)
			continue;
		const actor = event.userId;
		const named = TELL_TYPES.has(event.type)
			? await stillHere(
					tx,
					await usersOfPeople(tx, namedPeople(event.payload), actor),
				)
			: [];
		const others = await otherParties(tx, {
			type: event.type,
			actorUserId: actor,
			entityId,
			at: event.createdAt,
		});
		for (const userId of new Set([...others, ...named]))
			rows.push({
				userId,
				actorUserId: actor,
				type: event.type,
				entityType: resource,
				entityId,
				payload: NOTHING,
				createdAt: event.createdAt,
				pushedAt: now,
				sourceEventId: event.id,
			});
	}
	if (rows.length === 0) return 0;
	const { count } = await tx.apiEvent.createMany({
		data: rows,
		skipDuplicates: true,
	});
	return count;
}
