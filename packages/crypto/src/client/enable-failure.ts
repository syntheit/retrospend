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
	"deviceRecordNotSaved",
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
 * server saying no; `checkFailed` is a read-back that found the stored keys
 * are not the ones sent; `deviceRecordNotSaved` is this device failing to
 * remember that the account is keyed. In the last two the keys are saved and
 * the account stays keyed and OFF (the email reset is the way back).
 */
export function isFinalFailure(code: FailureCode | null): boolean {
	return (
		code === "notOffered" ||
		code === "checkFailed" ||
		code === "deviceRecordNotSaved"
	);
}

/**
 * The line a flow failure gets. The one mapping, for every platform: an
 * exhaustive record, so a new KeyFlowCode does not compile until it has a
 * line here. Only a read-back that found other keys ends the flow as
 * `checkFailed` (one that could not be made reads as `failed` or `tooMany`,
 * and trying again runs it again); a check made before sending (`malformed`)
 * sent nothing and can be tried again.
 */
const FAILURE_FOR_FLOW: Record<KeyFlowCode, FailureCode> = {
	wrongPassword: "wrongPassword",
	wrongCode: "wrongCode",
	rateLimited: "tooMany",
	notOffered: "notOffered",
	readBackFailed: "checkFailed",
	unreadable: "deviceRecordNotSaved",
	params: "failed",
	malformed: "failed",
	downgrade: "failed",
	unavailable: "failed",
	notFound: "failed",
	serverError: "failed",
	keyReused: "failed",
	sessionNotFresh: "failed",
	typo: "failed",
	wrongRecoveryKey: "failed",
	tokenExpired: "failed",
	recoveryUnavailable: "failed",
	conflict: "failed",
	unconfirmed: "failed",
	failed: "failed",
};

export const enableFailureFor = (code: KeyFlowCode): FailureCode =>
	FAILURE_FOR_FLOW[code];
