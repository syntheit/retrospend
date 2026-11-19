/**
 * What the expense write rules refuse, as typed errors. The domain knows no
 * transport: the server maps each to its own answer (trpc.ts, v1/core/serve.ts)
 * and the device to its InvalidInputError, with the same message.
 */
import { CUSTOM_RATE_TYPE } from "../rate-booking";

export const AMOUNT_ABOVE_ZERO = "Enter an amount above zero";
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

export const EXPENSE_NOT_FOUND = "Expense not found";
export const LEG_EDIT_REFUSED =
	"This entry moved money in an account. Delete it and add it again to change its amount, currency or date.";
export const LEG_DELETE_REFUSED =
	"This expense moved money in an account. Undo it from its transfer.";
/** A typed rate pinned to the home it was booked into, once the home changed. */
export const otherHomeMessage = (home: string) =>
	`This rate was into ${home}, your old home currency. Edit the rate instead.`;

/**
 * The one rule for "a typed rate pinned to a home the person no longer has":
 * `booked` is the home the rate was quoted into (null when it names none),
 * `home` the person's home now.
 */
export const bookedInOtherHome = (
	booked: string | null | undefined,
	home: string,
): booked is string => !!booked && booked !== home;

/**
 * What an edit's undo says once the home changed: a typed rate says which
 * home it was into, a table rate that its signed figures no longer hold. The
 * server (entry/expense.mutation.ts, restore-token.ts) and the device
 * (engine undo.ts) both ask here.
 */
export const undoAfterHomeChange = (
	rateType: string | null,
	booked: string,
): string =>
	rateType === CUSTOM_RATE_TYPE ? otherHomeMessage(booked) : UNDO_NOT_VALID;
/** An undo whose signed figures no longer fit (the home changed since). */
export const UNDO_NOT_VALID = "This undo is not valid anymore";
export const SPREAD_NOT_ON_DEVICE = "Spreading an expense is not on the device";

/** Which answer a refused edit or delete maps to on each transport. */
export type EditRefusalKind = "notFound" | "badRequest";

/**
 * The row cannot be reached or changed: not the person's, a row the policy
 * hides, or money an account leg pins. The kind picks the transport's code
 * (trpc NOT_FOUND or BAD_REQUEST); the message is the same everywhere.
 */
export class EditRefusal extends Error {
	override readonly name = "EditRefusal";
	constructor(
		readonly kind: EditRefusalKind,
		message: string,
	) {
		super(message);
	}
}
