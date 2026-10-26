import { AsyncLocalStorage } from "node:async_hooks";
import type { db as globalDb } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import type { Actor, ApplyResult } from "~/server/services/preview/types";
import { amountsOfChanges, extractEventData } from "./data";
import { eventTypeOfMutation } from "./mutation-events";
import { notifyEventsCommitted } from "./notify";
import { appendEvent, type EventWriter } from "./outbox";

/**
 * The seam that writes events without every service doing it. Two paths
 * meet here:
 *
 * 1. A v1 write route runs inside `withEventIntent(type)` (the route's
 *    `meta.event`). Whatever money mutation it applies first writes the
 *    event in its own transaction (`recordMutationEvent`, called by the
 *    preview runner), so the event is atomic with the write and carries the
 *    figures the write moved.
 * 2. A route whose service writes without a mutation (settings, categories)
 *    finds `recorded` still false when its handler returns, and the route
 *    wrapper appends the event right after commit (`appendRouteEvent`). That
 *    is the one gap in atomicity; moving those services onto mutations
 *    closes it (docs/ui/GAPS.md).
 *
 * The web's tRPC procedures have no intent: a mutation then uses its entry
 * in MUTATION_EVENTS (mutation-events.ts).
 */
export type EventIntent = { type: string; recorded: boolean };

const storage = new AsyncLocalStorage<EventIntent>();

/** Runs `fn` with the event its writes should append. */
export function withEventIntent<T>(
	intent: EventIntent,
	fn: () => Promise<T>,
): Promise<T> {
	return storage.run(intent, fn);
}

/**
 * Called by the preview runner inside the apply transaction, after the
 * mutation and its figure diff succeeded. Returns whether it appended.
 */
export async function recordMutationEvent(
	tx: EventWriter,
	mutation: { id: string },
	result: ApplyResult<unknown>,
	actor: Actor,
): Promise<boolean> {
	const intent = storage.getStore();
	// One request, one event: later mutations of the same route add none.
	if (intent?.recorded) return false;
	const type =
		intent?.type ?? eventTypeOfMutation(mutation.id, result.value);
	if (!type) return false;
	const { entityId, data } = extractEventData(result.value);
	const amounts = amountsOfChanges(result.changes);
	await appendEvent(tx, {
		type,
		actorUserId: actor.userId,
		entityId,
		data: { ...data, amounts: [...amounts, ...data.amounts].slice(0, 32) },
	});
	if (intent) intent.recorded = true;
	return true;
}

/**
 * After a v1 write whose service used no mutation: appends the route's
 * event from the request and its answer (ids and Money only). Never throws:
 * the write has committed, and failing the request would only make a client
 * retry it.
 */
export async function appendRouteEvent(
	db: typeof globalDb,
	actor: Actor,
	type: string,
	input: unknown,
	output: unknown,
): Promise<void> {
	try {
		const fromOutput = extractEventData(output);
		const entityId = fromOutput.entityId ?? extractEventData(input).entityId;
		await userTransaction(db, actor.userId, (tx) =>
			appendEvent(tx, {
				type,
				actorUserId: actor.userId,
				entityId,
				data: fromOutput.data,
			}),
		);
		notifyEventsCommitted(actor);
	} catch (error) {
		console.error(`Could not append the ${type} event:`, error);
	}
}
