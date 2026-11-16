export type VaultErrorCode =
	/** A write's base version is not the stored one, or the id already exists. */
	| "conflict"
	/** The batch is malformed. The message never carries the offending bytes. */
	| "invalid_input";

const MESSAGES: Record<VaultErrorCode, string> = {
	conflict: "The vault records changed since they were read",
	invalid_input: "Invalid vault write",
};

/**
 * Stable codes; transports map them (F7b), users never see the text. `ids`
 * names the records that conflicted (ids only, never bytes) and is empty for
 * `invalid_input`.
 */
export class VaultError extends Error {
	readonly code: VaultErrorCode;
	readonly ids: readonly string[];
	constructor(code: VaultErrorCode, ids: readonly string[] = []) {
		super(MESSAGES[code]);
		this.name = "VaultError";
		this.code = code;
		this.ids = ids;
	}
}
