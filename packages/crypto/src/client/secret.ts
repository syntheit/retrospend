// The one place a typed password becomes what the server checks as "the
// password", on the web and on the phone.
//
// An account without keys signs in with what was typed. An account with keys
// signs in with its sign-in secret: Argon2id over the password with the
// account's salt and parameters, then the auth key as base64url.
//
// Downgrade: a server that answers "no keys" to an account that has them
// would get the typed password. Once the account has been seen keyed (the
// record), a null answer, an error or a missing route is refused and the
// typed password is never sent. Only an unrecorded account against a server
// with no route (a null answer) falls back. The record is written after the
// server's keyed answer was derived from; a refusal sends nothing anyway, so
// a refused first attempt needs no record.
import { deriveMasterKey, masterSubkeys } from "../keys";
import { signInSecret } from "../sign-in-secret";
import {
	allowedParams,
	asKeyFlowError,
	type FlowPorts,
	type Kdf,
	KeyFlowError,
	readSalt,
	secretBin,
} from "./flow";

/**
 * The sign-in secret for a password and a kdf. Every key made (the master key
 * and both subkeys) is wiped before this returns or throws.
 */
export async function deriveSignInSecret(
	ports: Pick<FlowPorts, "primitives" | "paint">,
	password: string,
	kdf: Kdf,
): Promise<string> {
	// Checked before the library loads and before any work.
	const params = allowedParams(kdf);
	const salt = readSalt(kdf.salt);
	const p = await ports.primitives();
	const bin = secretBin(p);
	try {
		await ports.paint?.();
		const master = bin.keep(deriveMasterKey(p, password, salt, params));
		const { authKey, wrapKey } = masterSubkeys(p, master);
		bin.keep(authKey);
		bin.keep(wrapKey);
		return signInSecret(authKey);
	} catch (error) {
		throw asKeyFlowError(error);
	} finally {
		bin.wipeAll();
	}
}

async function recorded(ports: FlowPorts): Promise<boolean> {
	try {
		return await ports.record.has();
	} catch {
		throw new KeyFlowError("unreadable");
	}
}

async function mark(ports: FlowPorts): Promise<void> {
	try {
		await ports.record.set();
	} catch {
		throw new KeyFlowError("unreadable");
	}
}

/**
 * The text to send as the password. Throws KeyFlowError, and the typed
 * password is never sent after a failure: `downgrade` for a recorded account
 * the server now says has no keys, `unreadable` when the record cannot be
 * read or written, `rateLimited` and `unavailable` for the server, `params`
 * and `malformed` for an answer that is not safe to derive from.
 */
export async function signInSecretFor(
	ports: FlowPorts,
	password: string,
): Promise<string> {
	// Nothing to derive; the server refuses an empty password either way.
	if (password === "") return password;
	// Read first: without the record the defense cannot work.
	const wasKeyed = await recorded(ports);
	const kdf = await ports.lookup();
	if (kdf === null) {
		if (wasKeyed) throw new KeyFlowError("downgrade");
		return password;
	}
	const secret = await deriveSignInSecret(ports, password, kdf);
	await mark(ports);
	return secret;
}

/**
 * Whether the account has keys, for a prompt that must not send a typed
 * password at all for such an account. True from the record without asking
 * the server (also when the server now says otherwise: sending nothing is the
 * safe answer), true and recorded when the server says keyed, false when it
 * says none. Throws KeyFlowError when it cannot be told.
 */
export async function accountIsKeyed(ports: FlowPorts): Promise<boolean> {
	if (await recorded(ports)) return true;
	const kdf = await ports.lookup();
	if (kdf === null) return false;
	await mark(ports);
	return true;
}
