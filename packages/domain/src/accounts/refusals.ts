/**
 * What an account write refuses and in which words: the one owner of the
 * messages, so the server's tRPC and v1 answers and the device's booking say
 * the same thing (M6, slice-device-wealth.md). The server maps `kind` to
 * NOT_FOUND or BAD_REQUEST; the device to its own not-found and invalid-input
 * errors.
 */
import { currencyDecimals } from "../money";
import { isLiability } from "./places";

export type AccountRefusalKind = "notFound" | "badRequest";

export class AccountRefusal extends Error {
	override readonly name = "AccountRefusal";
	constructor(
		readonly kind: AccountRefusalKind,
		message: string,
	) {
		super(message);
	}
}

/** An account write that names an account the person does not have. */
export const ACCOUNT_NOT_FOUND = "Account not found";
/** Close, reopen and delete read the row without the closed check, and say "Asset". */
export const ASSET_NOT_FOUND = "Asset not found";
export const ACCOUNT_CLOSED = "This account is closed. Reopen it to change it.";
export const CURRENCY_LOCKED =
	"Money moved through this account in its currency. Add a new account instead.";
export const SIDE_LOCKED =
	"Money moved through this account as something you have or owe. Add a new account instead.";
export const PICK_VALID_DATE = "Pick a valid date";
export const MOVE_IN_FUTURE = "A money move cannot be dated in the future";

/** No table rate and no usable typed rate for the currency. */
export const noRateFound = (currency: string) =>
	`No exchange rate found for ${currency}. Please sync rates or provide a custom rate.`;

/**
 * Legs are signed in what you have and an account's history reads them by its
 * type, so once money moved through it neither its currency nor which side of
 * net worth it is on (something you have or something you owe) can change.
 * The message to refuse with when the edit would change one of them; whether
 * the account has legs at all is the caller's read (null here means nothing
 * to refuse, so no read is needed).
 */
export function legChangeMessage(
	existing: { readonly currency: string; readonly type: string },
	input: { readonly currency: string; readonly type: string },
): string | null {
	if (existing.currency !== input.currency) return CURRENCY_LOCKED;
	if (isLiability(existing.type) !== isLiability(input.type))
		return SIDE_LOCKED;
	return null;
}

/**
 * Refuses an amount with more decimals than the currency has: it would be
 * rounded into somebody's balance. The message to refuse with, or null.
 */
export function excessDecimals(
	text: string | null | undefined,
	currency: string,
	field = "amount",
): string | null {
	if (!text) return null;
	const decimals = currencyDecimals(currency);
	const fraction = text.split(".")[1] ?? "";
	return fraction.length > decimals
		? `${field} ${text} has more decimals than ${currency} allows (${decimals})`
		: null;
}
