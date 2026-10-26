import type { Money } from "@retrospend/domain/money-minor";
import { decimalMoney } from "~/server/services/expense-list/money";
import type { Prisma } from "~prisma";
import type { PushKind } from "./kinds";
import type { PushData } from "./message";

/**
 * Who a shared write should reach. An outbox event sits in the feed of the
 * person who made the change, so the other people involved are found here,
 * from membership as it is when the push worker runs, reading the entity
 * the event names (never its text). The actor is never told about their own
 * change. People who are not users (guests, shadow profiles) have no
 * device, so they are skipped.
 *
 * A write whose entity is gone by now (a deleted expense) reaches nobody:
 * the push is for what is still there to open. An event whose actor has no
 * part in the entity reaches nobody either, so an id that arrived with a
 * request can never aim a push at people the actor has nothing to do with.
 */

export type PushEvent = {
	type: PushKind;
	actorUserId: string;
	entityId: string;
};

export type PushRecipient = {
	userId: string;
	amount: Money | null;
};

export type PushPlan = {
	entity: NonNullable<PushData["entity"]>;
	ids: PushData["ids"];
	recipients: PushRecipient[];
};

type Reader = Pick<
	Prisma.TransactionClient,
	"sharedTransaction" | "fixRequest" | "payment" | "projectParticipant"
>;
export type PartiesReader = Reader;

/** What the planners read: who made the change and what it is about. */
type Subject = Omit<PushEvent, "type">;

type Person = { type: string; id: string };

function amountOf(
	value: Prisma.Decimal | null,
	currency: string,
): Money | null {
	if (!value || value.isZero()) return null;
	try {
		return decimalMoney(value, currency);
	} catch {
		return null;
	}
}

function takesPart(actorUserId: string, people: Person[]): boolean {
	return people.some((p) => p.type === "user" && p.id === actorUserId);
}

/** One recipient per user: the actor and non-users dropped. */
function users(
	people: { person: Person; amount: Money | null }[],
	actorUserId: string,
): PushRecipient[] {
	const out = new Map<string, PushRecipient>();
	for (const { person, amount } of people) {
		if (person.type !== "user" || person.id === actorUserId) continue;
		const known = out.get(person.id);
		if (!known || (!known.amount && amount))
			out.set(person.id, { userId: person.id, amount });
	}
	return [...out.values()];
}

async function sharedExpense(
	db: Reader,
	event: Subject,
): Promise<PushPlan | null> {
	const row = await db.sharedTransaction.findUnique({
		where: { id: event.entityId },
		select: {
			currency: true,
			projectId: true,
			createdByType: true,
			createdById: true,
			paidByType: true,
			paidById: true,
			splitParticipants: {
				select: {
					participantType: true,
					participantId: true,
					shareAmount: true,
				},
			},
		},
	});
	if (!row) return null;
	const inProject =
		row.projectId !== null &&
		(await db.projectParticipant.count({
			where: {
				projectId: row.projectId,
				participantType: "user",
				participantId: event.actorUserId,
			},
		})) > 0;
	if (
		!inProject &&
		!takesPart(event.actorUserId, [
			{ type: row.createdByType, id: row.createdById },
			{ type: row.paidByType, id: row.paidById },
			...row.splitParticipants.map((p) => ({
				type: p.participantType,
				id: p.participantId,
			})),
		])
	)
		return null;
	return {
		entity: { type: "shared_expense", id: event.entityId },
		ids: {},
		recipients: users(
			[
				...row.splitParticipants.map((p) => ({
					person: { type: p.participantType, id: p.participantId },
					amount: amountOf(p.shareAmount, row.currency),
				})),
				{
					person: { type: row.paidByType, id: row.paidById },
					amount: null,
				},
			],
			event.actorUserId,
		),
	};
}

async function fixRequest(
	db: Reader,
	event: Subject,
): Promise<PushPlan | null> {
	const row = await db.fixRequest.findUnique({
		where: { id: event.entityId },
		select: {
			transactionId: true,
			askedType: true,
			askedId: true,
			requestedByType: true,
			requestedById: true,
		},
	});
	if (
		!row ||
		!takesPart(event.actorUserId, [
			{ type: row.askedType, id: row.askedId },
			{ type: row.requestedByType, id: row.requestedById },
		])
	)
		return null;
	return {
		entity: { type: "fix_request", id: event.entityId },
		ids: { transactionId: row.transactionId },
		recipients: users(
			[{ person: { type: row.askedType, id: row.askedId }, amount: null }],
			event.actorUserId,
		),
	};
}

async function payment(db: Reader, event: Subject): Promise<PushPlan | null> {
	const row = await db.payment.findUnique({
		where: { id: event.entityId },
		select: {
			payerType: true,
			payerId: true,
			payeeType: true,
			payeeId: true,
			recordedByType: true,
			recordedById: true,
			amount: true,
			currency: true,
		},
	});
	if (
		!row ||
		!takesPart(event.actorUserId, [
			{ type: row.payerType, id: row.payerId },
			{ type: row.payeeType, id: row.payeeId },
			{ type: row.recordedByType, id: row.recordedById },
		])
	)
		return null;
	const amount = amountOf(row.amount, row.currency);
	return {
		entity: { type: "payment", id: event.entityId },
		ids: {},
		recipients: users(
			[
				{ person: { type: row.payerType, id: row.payerId }, amount },
				{ person: { type: row.payeeType, id: row.payeeId }, amount },
			],
			event.actorUserId,
		),
	};
}

type Planner = (db: Reader, event: Subject) => Promise<PushPlan | null>;

const PLANNERS: Partial<Record<PushKind, Planner>> = {
	"shared_expense.created": sharedExpense,
	"shared_expense.updated": sharedExpense,
	"fix_request.created": fixRequest,
	"payment.recorded": payment,
	"payment.confirmed": payment,
	"payment.not_received": payment,
	"payment.reminded": payment,
};

/** The people to push to for an event, or null when there is nothing to open. */
export function planPush(
	db: Reader,
	event: PushEvent,
): Promise<PushPlan | null> {
	const plan = PLANNERS[event.type];
	return plan ? plan(db, event) : Promise.resolve(null);
}

const BY_RESOURCE: Readonly<Record<string, Planner>> = {
	shared_expense: sharedExpense,
	fix_request: fixRequest,
	payment,
};

/**
 * The other users on the thing an event of any type is about (a split
 * expense, a fix request, a payment), found the way a push finds them. Empty
 * for an unknown resource, a gone entity, or an actor who has no part in it.
 */
export async function otherParties(
	db: Reader,
	event: Subject & { type: string },
): Promise<string[]> {
	const planner = BY_RESOURCE[event.type.split(".")[0] ?? ""];
	const plan = planner ? await planner(db, event) : null;
	return plan?.recipients.map((r) => r.userId) ?? [];
}
