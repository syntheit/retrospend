/**
 * What the expense write rules refuse, as typed errors. The domain knows no
 * transport: the server maps each to its own answer (trpc.ts, v1/core/serve.ts)
 * and the device to its InvalidInputError, with the same message.
 */

export const AMOUNT_ABOVE_ZERO = "Enter an amount above 0";
export const CATEGORY_NOT_FOUND = "Category not found";

/** The v1 answers a refused category can have: write routes say not_found, categorize says forbidden. */
export type CategoryRefusalCode = "not_found" | "forbidden";

/** An expense needs an amount above 0 once stored at the column's scale. */
export class AmountRefusedError extends Error {
	constructor() {
		super(AMOUNT_ABOVE_ZERO);
		this.name = "AmountRefusedError";
	}
}

/** A category that is not the person's, does not exist, or cannot hold an expense. */
export class CategoryNotFoundError extends Error {
	constructor(
		/** The code v1 answers with: the call site's, because its routes differ. */
		readonly v1Code: CategoryRefusalCode,
	) {
		super(CATEGORY_NOT_FOUND);
		this.name = "CategoryNotFoundError";
	}
}
