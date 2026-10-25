import * as z from "zod";
import { v1 } from "../common/meta";
import { moneySchema } from "../common/money";
import {
	previewPathOf,
	previewResultSchema,
	undoTokenSchema,
} from "../common/preview";
import type { RouteScope } from "../common/scopes";
import { idSchema } from "../core";

/**
 * Shared pieces of the ledger groups (expenses, income, transfers,
 * recurring, needs-you). Amounts that go in are decimal text as typed, never
 * JSON numbers (no float ever carries money); amounts that come out are the
 * Money DTO (integer minor units).
 */

/** Amount columns are Decimal(19,8): 11 digits before the point, 8 after. */
export const AMOUNT_TEXT_PATTERN = /^\d{1,11}(\.\d{1,8})?$/;

export const amountTextSchema = z
	.string()
	.regex(AMOUNT_TEXT_PATTERN, "Use digits and at most 8 decimals, like 1234.56")
	.refine((v) => /[1-9]/.test(v), "Must be above zero")
	.meta({
		id: "AmountText",
		description:
			"A positive amount as decimal text, in the currency's major units.",
		examples: ["1234.56"],
	});

/** The homeRate column is Decimal(28,12): 16 digits before the point, 12 after. */
export const RATE_TEXT_PATTERN = /^\d{1,16}(\.\d{1,12})?$/;

export const rateTextSchema = z
	.string()
	.regex(RATE_TEXT_PATTERN, "Use digits and at most 12 decimals, like 1.0834")
	.refine((v) => /[1-9]/.test(v), "Must be above zero")
	.meta({
		id: "RateText",
		description:
			"A typed exchange rate as decimal text: 1 unit of the entry's currency is this many units of the home currency.",
		examples: ["1468.5"],
	});

/** A day with no time, in the caller's time zone. */
export const daySchema = z.iso.date().meta({ id: "Day" });

/** What a money write returns beside its result, to put it back. */
export const undoField = {
	undo: undoTokenSchema.meta({
		description:
			"Valid for 24 hours. Send it to the group's undo route to revert this write.",
	}),
};

/** Body of every group's undo route (and its preview twin). */
export const undoInputSchema = z
	.object({ token: undoTokenSchema })
	.meta({ id: "UndoInput" });

/** One account's balance before and after a write, in its own currency. */
export const accountChangeSchema = z
	.object({
		accountId: idSchema,
		name: z.string(),
		before: moneySchema,
		after: moneySchema,
	})
	.meta({ id: "AccountChange" });

/** A rate as a pair of amounts: "USD 1 = ARS 1,468" is { unit: USD 1, value: ARS 1,468 }. */
export const ratePairSchema = z
	.object({ unit: moneySchema, value: moneySchema })
	.meta({ id: "RatePair" });

/**
 * The preview twin of a money write: `POST <path>/preview` with the write's
 * own input object, answering PreviewResult. The write's scope applies.
 */
export function previewTwin<S extends z.ZodType>(config: {
	/** The write's path. */
	path: string;
	/** The twin's path when it cannot be `<path>/preview` (two writes share a path). */
	twinPath?: string;
	/** The write this previews, for example "POST /expenses". */
	of: string;
	operationId: string;
	tags: string[];
	scope: RouteScope;
	input: S;
}) {
	const path = (config.twinPath ?? previewPathOf(config.path)) as `/${string}`;
	return v1
		.route({
			method: "POST",
			path,
			operationId: config.operationId,
			tags: config.tags,
			summary: `Preview ${config.of}`,
			description: `Runs ${config.of} in a transaction that always rolls back and answers what it would change and what it would not. Nothing is written.`,
		})
		.meta({ scope: config.scope, previewOf: config.path })
		.input(config.input)
		.output(previewResultSchema);
}
