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
