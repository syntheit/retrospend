// What the enable sheet's callbacks (makeKeys, save) reject with, on the web
// and on the phone: the codes, the error that carries one, and which codes end
// the flow. Each platform keeps only its words for them (errors.* in
// protection.json). Mapping what the key flows throw (KeyFlowError) onto these
// belongs to the platform adapters.

/** What the caller's callbacks reject with, and the line each one gets (errors.* in protection.json). */
export const FAILURE_CODES = [
	"wrongPassword",
	"wrongCode",
	"tooMany",
	"notOffered",
	"failed",
	"checkFailed",
] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

export class EnableFailure extends Error {
	constructor(readonly code: FailureCode) {
		super(code);
		this.name = "EnableFailure";
	}
}

/** The code of whatever a callback threw; anything that is not an EnableFailure is `failed`. */
export function failureCode(error: unknown): FailureCode {
	return error instanceof EnableFailure ? error.code : "failed";
}

/**
 * Failures that end the flow: trying again cannot help. `notOffered` is the
 * server saying no; `checkFailed` is the read-back after the keys were saved
 * (the account stays keyed and OFF, and the email reset is the way back).
 */
export function isFinalFailure(code: FailureCode | null): boolean {
	return code === "notOffered" || code === "checkFailed";
}
