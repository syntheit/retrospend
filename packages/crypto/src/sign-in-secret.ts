// The sign-in secret of an account with Advanced protection: the 32-byte auth
// key (masterSubkeys) written as unpadded base64url, 43 characters. This is the
// one place that says so. The server hashes the text as the account's password,
// better-auth checks it at sign-in, and every client derives the same text from
// the typed password (prelogin salt and parameters, then Argon2id).
import { fromBase64Url, toBase64Url } from "./base64url";
import { bad } from "./errors";
import { isBytes, KEY_BYTES } from "./primitives";

export const SIGN_IN_SECRET_LENGTH = 43;

/** The text a client sends as the password for an account with keys. */
export function signInSecret(authKey: Uint8Array): string {
	if (!isBytes(authKey) || authKey.length !== KEY_BYTES) bad();
	return toBase64Url(authKey);
}

/** Whether `text` is exactly what `signInSecret` writes for some 32 bytes. */
export function isSignInSecret(text: string): boolean {
	const bytes = fromBase64Url(text);
	return bytes !== null && bytes.length === KEY_BYTES;
}
