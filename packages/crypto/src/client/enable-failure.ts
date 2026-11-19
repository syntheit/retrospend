// What the enable sheet's callbacks (makeKeys, save) reject with, on the web
// and on the phone: the codes, the error that carries one, and which codes end
// the flow. Each platform keeps only its words for them (errors.* in
// protection.json). The one mapping from what the key flows throw
// (KeyFlowCode) onto these is here; the platform adapters only throw.
import type { KeyFlowCode } from "./flow";

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

/**
 * The line a flow failure gets. The one mapping, for every platform: an
 * exhaustive record, so a new KeyFlowCode does not compile until it has a
 * line here. Only the read-back ends the flow as `checkFailed`; a check made
 * before sending (`malformed`) sent nothing and can be tried again.
 */
const FAILURE_FOR_FLOW: Record<KeyFlowCode, FailureCode> = {
	wrongPassword: "wrongPassword",
	wrongCode: "wrongCode",
	rateLimited: "tooMany",
	notOffered: "notOffered",
	readBackFailed: "checkFailed",
	params: "failed",
	malformed: "failed",
	downgrade: "failed",
	unavailable: "failed",
	unreadable: "failed",
	sessionNotFresh: "failed",
	typo: "failed",
	wrongRecoveryKey: "failed",
	tokenExpired: "failed",
	recoveryUnavailable: "failed",
	conflict: "failed",
	failed: "failed",
};

export const enableFailureFor = (code: KeyFlowCode): FailureCode =>
	FAILURE_FOR_FLOW[code];
