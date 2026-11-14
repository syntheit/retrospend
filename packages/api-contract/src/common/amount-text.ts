import * as z from "zod";

// Apart from the ledger groups so the budget primitives, and the sync schemas a
// device validates with, load without the route builder.

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
