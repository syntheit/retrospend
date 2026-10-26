/**
 * Telling the people on a shared expense that it was deleted. The delete
 * removes the rows the other people are read from, so the people to tell are
 * read first and ride on the event (events/data.ts, events/audience.ts).
 */
import type { Prisma, PrismaClient } from "~prisma";

import { appendRouteEvent } from "../events/scope";
import { SharedTransactionService } from "./transaction.service";
import { type ParticipantRef, sameParticipant } from "./types";

type Db = PrismaClient | Prisma.TransactionClient;

/** The payer and everyone with a share, once each, without `actor`. */
export async function peopleToTell(
	db: Db,
	id: string,
	actor: ParticipantRef,
): Promise<ParticipantRef[]> {
	const row = await (db as PrismaClient).sharedTransaction.findUnique({
		where: { id },
		select: {
			paidByType: true,
			paidById: true,
			splitParticipants: {
				select: { participantType: true, participantId: true },
			},
		},
	});
	if (!row) return [];
	const people: ParticipantRef[] = [
		{ participantType: row.paidByType, participantId: row.paidById },
		...row.splitParticipants,
	];
	return people.filter(
		(p, i) =>
			!sameParticipant(p, actor) &&
			people.findIndex((q) => sameParticipant(p, q)) === i,
	);
}

/**
 * The older delete procedure (the activity list, guests): deletes, then
 * appends the same event the money mutation does, since this path has no
 * preview to write it. A guest has no feed of their own, so none is written.
 */
export async function deleteSharedAndRecord(
	db: PrismaClient,
	actor: ParticipantRef,
	id: string,
	options: Parameters<SharedTransactionService["delete"]>[1],
) {
	const user = actor.participantType === "user";
	const tell = user ? await peopleToTell(db, id, actor) : [];
	await new SharedTransactionService(db, actor).delete(id, options);
	if (user)
		await appendRouteEvent(
			db as never,
			{ userId: actor.participantId },
			"shared_expense.deleted",
			{ id },
			{ id, tell },
		);
}
