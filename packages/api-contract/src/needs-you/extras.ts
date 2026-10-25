import * as z from "zod";
import { v1 } from "../common/meta";
import { timestampSchema } from "../core";

const TAG = ["Needs you"];

/** An item's stable id: `<type>:<entity id>`, or the type alone. */
export const needsYouItemIdSchema = z
	.string()
	.min(3)
	.max(255)
	.regex(/^[a-z]+\.[A-Za-z]+(:.+)?$/)
	.meta({ id: "NeedsYouItemId", examples: ["split.review:abc123"] });

export const snoozeSchema = z
	.object({
		id: z.uuid().optional().meta({
			description:
				"A client-made id. Sending the same id twice lands on the same row.",
		}),
		itemId: needsYouItemIdSchema,
	})
	.meta({ id: "SnoozeNeedsYouItem" });

export const snoozedSchema = z
	.object({
		itemId: needsYouItemIdSchema,
		/** When the item comes back: the start of your next day. */
		until: timestampSchema,
	})
	.meta({ id: "NeedsYouSnoozed" });

export const needsYouExtrasContract = {
	snooze: v1
		.route({
			method: "POST",
			path: "/needs-you/snoozes",
			operationId: "snoozeNeedsYouItem",
			tags: TAG,
			summary: "Later: hide an item until the start of tomorrow",
			description:
				"Moves no money. An item that changes type comes back by itself.",
			successStatus: 201,
		})
		.meta({ scope: "write:settings", event: "needs_you.snoozed" })
		.input(snoozeSchema)
		.output(snoozedSchema),
	unsnooze: v1
		.route({
			method: "DELETE",
			path: "/needs-you/snoozes/{itemId}",
			operationId: "unsnoozeNeedsYouItem",
			tags: TAG,
			summary: "Bring a snoozed item back now",
		})
		.meta({ scope: "write:settings", event: "needs_you.unsnoozed" })
		.input(z.object({ itemId: needsYouItemIdSchema }))
		.output(z.object({ itemId: needsYouItemIdSchema })),
};
