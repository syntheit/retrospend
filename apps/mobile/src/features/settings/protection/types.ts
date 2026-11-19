/** The screens of the enable sheet, in the order the person meets them. */
export type EnableStep =
	| "what"
	| "password"
	| "methods"
	| "saveKey"
	| "confirmKey"
	| "confirmYou"
	| "done";

/** What making the keys answers: the key as the person writes it down, or a refusal. */
export type MakeKeysResult =
	| { ok: true; recoveryKeyText: string }
	| { ok: false };

/** Why saving the keys was refused; each one has its words in `protection.errors`. */
export type ConfirmFailure =
	| "wrongPassword"
	| "wrongCode"
	| "tooMany"
	| "notOffered"
	| "failed"
	| "checkFailed";

export type ConfirmResult =
	| { ok: true }
	| { ok: false; reason: ConfirmFailure };

/**
 * Refusals the person cannot retry from this sheet: the server no longer
 * offers protection, or the read-back found the keys do not open. The account
 * stays keyed and off, so the sheet says so and only closes.
 */
export function isFinal(reason: ConfirmFailure): boolean {
	return reason === "notOffered" || reason === "checkFailed";
}

/** The two-factor code is six digits (the web's enable sheet holds the same rule). */
export const CODE_LENGTH = 6;
