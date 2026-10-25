import * as z from "zod";
import { v1 } from "../common/meta";
import { currencyCodeSchema } from "../common/money";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../common/pagination";
import { idSchema, timestampSchema } from "../core";

/**
 * An id inside an event (end-to-end encryption, owner rule 4): ids, never
 * titles or notes. The pattern is the same one the server checks before it
 * stores an event, so no sentence can ride in an id field.
 */
export const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** A name in `ids` or `amounts`: a dotted path such as "account.id" or a figure id. */
export const EVENT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/** The most ids and amounts one event carries. */
export const EVENT_DATA_LIMIT = 32;

/** One amount an event moved: a figure's change (`owed.owedToYou`) or a money field of the write. */
export const eventAmountSchema = z
	.object({
		name: z.string().regex(EVENT_NAME_PATTERN),
		/** Minor units; for a figure change this is the delta, signed. */
		minor: z.int(),
		currency: currencyCodeSchema,
	})
	.meta({ id: "EventAmount" });

export const eventDataSchema = z
	.object({
		/** Related ids by name: `categoryId`, `accountId`. Never text. */
		ids: z.record(
			z.string().regex(EVENT_NAME_PATTERN),
			z.string().regex(EVENT_ID_PATTERN),
		),
		amounts: z.array(eventAmountSchema).max(EVENT_DATA_LIMIT),
		/** True when the write touched more than the event could list. */
		truncated: z.boolean(),
	})
	.meta({ id: "EventData" });

export type EventData = z.infer<typeof eventDataSchema>;

/**
 * One event in a user's feed and in a webhook delivery. It says what
 * happened and to which rows; fetch the resource for its current text.
 */
export const apiEventSchema = z
	.object({
		id: idSchema,
		/** Pass as `after` to continue from here. */
		cursor: z.string(),
		type: z.string().meta({ examples: ["expense.created"] }),
		occurredAt: timestampSchema,
		/** The user who made the change; may be someone else for a shared write. */
		actorUserId: idSchema.nullable(),
		entity: z.object({ type: z.string(), id: z.string() }).nullable(),
		data: eventDataSchema,
	})
	.meta({ id: "ApiEvent" });

export type ApiEventDto = z.infer<typeof apiEventSchema>;

export const eventsQuerySchema = z.object({
	after: z.string().min(1).max(512).optional().meta({
		description:
			"The cursor of the last event you saw. Omit it to start from the oldest kept event.",
	}),
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(MAX_PAGE_LIMIT)
		.default(DEFAULT_PAGE_LIMIT),
});

export const eventsPageSchema = z
	.object({
		items: z.array(apiEventSchema),
		/** Send as `after` next time; the input `after` again when nothing is new. */
		cursor: z.string().nullable(),
		hasMore: z.boolean(),
	})
	.meta({ id: "EventsPage" });

export const eventsContract = {
	list: v1
		.route({
			method: "GET",
			path: "/events",
			operationId: "listEvents",
			tags: ["Events"],
			summary: "The caller's change feed, oldest first",
			description:
				"Events for the signed-in user in commit order. Poll with `after` set to the last `cursor`; an event shows up a moment after its write commits, never out of order. Events are kept for 30 days and carry ids and amounts only.",
		})
		.meta({ scope: "read" })
		.input(eventsQuerySchema)
		.output(eventsPageSchema),
};
