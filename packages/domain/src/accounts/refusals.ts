/**
 * What an account write refuses and in which words: the one owner of the
 * messages, so the server's tRPC and v1 answers and the device's booking say
 * the same thing (M6, slice-device-wealth.md). The server maps `kind` to
 * NOT_FOUND or BAD_REQUEST; the device to its own not-found and invalid-input
 * errors.
 */
import { currencyDecimals } from "../money";
import { dec } from "../precise-decimal";
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

/** The most significant digits a typed amount may have: the services still hold one as a double. */
const MAX_SIGNIFICANT_DIGITS = 15;

/**
 * An amount typed as text that is refused when a double cannot hold it exactly
 * (more than 15 significant digits), after the decimals check. The message to
 * refuse with, or null. The server's exactAmount and the device read this.
 */
export function amountRefusal(
	text: string,
	currency: string,
	field = "amount",
): string | null {
	const decimals = excessDecimals(text, currency, field);
	if (decimals !== null) return decimals;
	const [whole = "", fraction = ""] = text.split(".");
	return `${whole}${fraction}`.replace(/^0+/, "").length >
		MAX_SIGNIFICANT_DIGITS
		? `${field} ${text} has too many digits to split exactly`
		: null;
}

/** A typed rate a double would change is refused, never stored altered. */
export function rateRefusal(text: string, field: string): string | null {
	return dec(String(Number(text))).eq(dec(text))
		? null
		: `${field} ${text} has too many digits to keep exactly`;
}

export interface TypedFields {
	readonly currency: string;
	readonly balance: string;
	readonly exchangeRate?: string | null;
	readonly interestRate?: string | null;
	readonly minimumPayment?: string | null;
}

/**
 * What an account create or edit refuses about its typed numbers, in the
 * order the v1 route checks them (the minimum payment's decimals, the
 * balance, the typed rate, the interest, the minimum payment's digits).
 */
export function typedFieldsRefusal(f: TypedFields): string | null {
	return (
		excessDecimals(f.minimumPayment, f.currency, "minimumPayment") ??
		amountRefusal(f.balance, f.currency, "balance") ??
		(f.exchangeRate ? rateRefusal(f.exchangeRate, "exchangeRate") : null) ??
		(f.interestRate ? rateRefusal(f.interestRate, "interestRate") : null) ??
		(f.minimumPayment
			? amountRefusal(f.minimumPayment, f.currency, "minimumPayment")
			: null)
	);
}

/** What Update balance refuses about its typed numbers: the balance's decimals, then a typed rate. */
export function balanceFieldsRefusal(f: {
	readonly currency: string;
	readonly balance: string;
	readonly exchangeRate?: string | null;
}): string | null {
	return (
		excessDecimals(f.balance, f.currency, "balance") ??
		(f.exchangeRate ? rateRefusal(f.exchangeRate, "exchangeRate") : null)
	);
}
