import * as z from "zod";

/**
 * Event types (IMPLEMENTATION §2.2): every service mutation appends one
 * ApiEvent to the outbox in its own transaction, read by
 * `GET /events?after=`, webhooks and push. A type is `<resource>.<verb>`
 * in snake_case, past tense (`expense.created`, `payment.confirmed`,
 * `budget_envelope.moved`). Every write route names the event it emits in
 * its meta, and the contract test checks the name is registered here.
 * Groups add their types to EVENT_TYPES when they add the writes.
 */
export const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export const EVENT_TYPES = [] as const satisfies readonly string[];

export type EventType = (typeof EVENT_TYPES)[number];

export const eventTypeSchema = z
	.string()
	.regex(EVENT_TYPE_PATTERN)
	.meta({ id: "EventType", examples: ["expense.created"] });

export function isEventTypeName(value: string): boolean {
	return EVENT_TYPE_PATTERN.test(value);
}
