// What the recovery and Make new key screens say when a key flow stops, on the
// web and on the phone: the codes, the one mapping from what the flows throw
// (KeyFlowCode) onto them, and which ones end the flow. Each platform keeps
// only its words for them (recover.errors.* in protection.json). Sibling of
// enable-failure.ts, which words the enable sheet's failures.
import { asKeyFlowError, type KeyFlowCode } from "./flow";

export const RECOVERY_FAILURE_CODES = [
	/** The text is not a recovery key. Nothing was sent. */
	"typo",
	/** The server refused the key's proof. */
	"wrongKey",
	/** This account has no recovery proof on the server. */
	"unavailable",
	/** The reset link is unknown, used or expired. */
	"linkExpired",
	/** The keys changed under the run: start again from the first step. */
	"keysChanged",
	/**
	 * The send may have gone through, or the check that would say could not be
	 * made. Not final: trying again asks first, and a retry of a send sends the
	 * same thing.
	 */
	"unconfirmed",
	"tooMany",
	"notOffered",
	"wrongPassword",
	/** A new recovery key was sent and the server does not hold it. */
	"notSaved",
	"failed",
] as const;
export type RecoveryFailureCode = (typeof RECOVERY_FAILURE_CODES)[number];

/**
 * The code a flow failure gets. An exhaustive record, so a new KeyFlowCode
 * does not compile until it has a line here. Codes with no line of their own
 * are `failed` and can be tried again.
 */
const FAILURE_FOR_FLOW: Record<KeyFlowCode, RecoveryFailureCode> = {
	typo: "typo",
	wrongRecoveryKey: "wrongKey",
	recoveryUnavailable: "unavailable",
	tokenExpired: "linkExpired",
	conflict: "keysChanged",
	unconfirmed: "unconfirmed",
	rateLimited: "tooMany",
	notOffered: "notOffered",
	wrongPassword: "wrongPassword",
	readBackFailed: "notSaved",
	params: "failed",
	malformed: "failed",
	downgrade: "failed",
	unavailable: "failed",
	unreadable: "failed",
	wrongCode: "failed",
	sessionNotFresh: "failed",
	notFound: "failed",
	serverError: "failed",
	keyReused: "failed",
	failed: "failed",
};

export const recoveryFailureFor = (code: KeyFlowCode): RecoveryFailureCode =>
	FAILURE_FOR_FLOW[code];

/** The code of whatever a recovery or Make new key callback threw. */
export const recoveryFailureOf = (error: unknown): RecoveryFailureCode =>
	recoveryFailureFor(asKeyFlowError(error).code);

/**
 * Codes after which nothing on the screen can help: the link is gone, the
 * server does not offer the feature, or a new key was sent and is not there
 * (the old one still works; the person starts Make new key again). A
 * `keysChanged` is not final: the screen goes back to its first step.
 */
export function isFinalRecoveryFailure(
	code: RecoveryFailureCode | null,
): boolean {
	return code === "linkExpired" || code === "notOffered" || code === "notSaved";
}

/**
 * A failure after which the recovery screen cannot be used again: the link is
 * gone, the server does not offer the feature, a new key was not saved, or the
 * account has no recovery key to try. The rest can be tried again.
 */
export const blocksRecoveryScreen = (
	code: RecoveryFailureCode | null,
): boolean => isFinalRecoveryFailure(code) || code === "unavailable";
