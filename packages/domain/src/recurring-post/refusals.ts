/**
 * What confirming or skipping a recurring period refuses, as typed errors.
 * The domain knows no transport: the server maps each kind to its own answer
 * (trpc.ts, v1/core/serve.ts) and the auto-post sweep counts them as raced.
 * The message is the one the person sees today; it names what the call was
 * (a payment, an item, income), so each call site passes its own.
 */

export type RecurringRefusalKind =
	| "not_found"
	| "already_posted"
	| "not_due"
	| "changed";

export const RECURRING_NOT_FOUND = "Recurring template not found";
export const RECURRING_INCOME_NOT_FOUND = "Recurring income not found";
export const PAYMENT_ALREADY_CONFIRMED = "This payment was already confirmed";
export const INCOME_ALREADY_CONFIRMED = "This income was already confirmed";
export const ITEM_ALREADY_SETTLED =
	"This item was already confirmed or skipped";
export const RECURRING_CHANGED = "Recurring expense changed";

/**
 * - `not_found`: the template is absent, another person's, paused, or no
 *   longer pays automatically with a fixed amount.
 * - `already_posted`: the due date asked for is not the template's now, or
 *   the compare-and-set on it lost to another write.
 * - `not_due`: the period's day has not come.
 * - `changed`: the caller named the template version it saw, and the template
 *   has moved since (another device or the web edited it).
 */
export class RecurringRefusal extends Error {
	override readonly name = "RecurringRefusal";
	constructor(
		readonly kind: RecurringRefusalKind,
		message: string,
	) {
		super(message);
	}
}

export const DATE_IN_FUTURE = "The date cannot be in the future";
export const DATE_BEFORE_PREVIOUS_DUE =
	"The date is before the previous due date";
export const AMOUNT_REQUIRED = "Confirm the amount for this recurring entry";
export const AMOUNT_FIXED = "This recurring amount is fixed";

export type RecurringInputKind =
	| "date_in_future"
	| "date_before_previous_due"
	| "amount_required"
	| "amount_fixed";

/**
 * The request itself is wrong (a paid-on day that cannot be, an amount given
 * or missing), not the template's state. Transports answer it as a bad
 * request, with the message as it is today.
 */
export class RecurringInputRefusal extends Error {
	override readonly name = "RecurringInputRefusal";
	constructor(
		readonly kind: RecurringInputKind,
		message: string,
	) {
		super(message);
	}
}
