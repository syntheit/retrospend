/**
 * The only error this package throws. The message is fixed per code and never
 * carries keys, plaintext, ids or the underlying library's text, so it is safe
 * to log. Callers map codes to user-facing results; users never see the code.
 */
export type CryptoErrorCode =
	/** An argument has the wrong type, length or range (a programming error). */
	| "invalid_input"
	/** Authentication failed: wrong key, wrong AAD, or the data was changed. */
	| "decrypt_failed";

const MESSAGES: Record<CryptoErrorCode, string> = {
	invalid_input: "Invalid cryptographic input",
	decrypt_failed: "Decryption failed",
};

export class CryptoError extends Error {
	readonly code: CryptoErrorCode;

	constructor(code: CryptoErrorCode) {
		super(MESSAGES[code]);
		this.name = "CryptoError";
		this.code = code;
	}
}
