export type ProtectionKeysErrorCode =
	/** The caller's `baseVersion` is not the stored one, or the set already exists or does not. */
	| "conflict"
	/** The change is malformed. The message never carries the offending bytes. */
	| "invalid_input";

const MESSAGES: Record<ProtectionKeysErrorCode, string> = {
	conflict: "The protection keys changed since they were read",
	invalid_input: "Invalid protection key change",
};

/** Stable codes; transports map them (F6b), users never see the text. */
export class ProtectionKeysError extends Error {
	readonly code: ProtectionKeysErrorCode;
	constructor(code: ProtectionKeysErrorCode) {
		super(MESSAGES[code]);
		this.name = "ProtectionKeysError";
		this.code = code;
	}
}

export type EnableProtectionRefusal =
	| "session_not_fresh"
	| "email_not_verified"
	| "no_password"
	| "wrong_password"
	| "two_factor_required"
	| "wrong_two_factor_code";

/** A precondition failed; the transport maps `code` to a problem. The text is never shown. */
export class EnableProtectionError extends Error {
	constructor(readonly code: EnableProtectionRefusal) {
		super(`Advanced protection was not enabled: ${code}`);
		this.name = "EnableProtectionError";
	}
}
