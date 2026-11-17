// What the web and the phone share when a typed password becomes keys: the
// error, the ports a platform fills in, and the reading of what a server says.
// Each platform keeps only its adapter (how to ask the server, where the
// "this account is keyed" record lives, which primitives to use, how its own
// errors are worded). Nothing here touches the network, storage or a screen.
import { fromBase64Url } from "../base64url";
import { CryptoError } from "../errors";
import { ARGON2_DEFAULT, checkArgon2Params } from "../keys";
import { type Argon2Params, type Primitives, SALT_BYTES } from "../primitives";

/** The account's key derivation values: the salt as base64url and the Argon2id parameters. */
export type Kdf = { salt: string; memoryKiB: number; passes: number };

/** The new password's Argon2id parameters. Fixed; only a test passes others (RotateOptions). */
export const NEW_PASSWORD_PARAMS: Argon2Params = ARGON2_DEFAULT;

export type KeyFlowCode =
	/** The server's parameters are outside the allowed range (nothing was derived). */
	| "params"
	/** A salt, wrap or answer that is not what it must be, or a check before sending failed. */
	| "malformed"
	/** The record says the account is keyed and the server now says it is not. */
	| "downgrade"
	| "rateLimited"
	/** The server cannot be reached or gave no usable answer. */
	| "unavailable"
	/** The keyed record cannot be read or written, so the defense cannot work. */
	| "unreadable"
	| "wrongPassword"
	/** The key set changed under the run (a second run may succeed). */
	| "conflict"
	/** The server no longer offers Advanced protection. */
	| "notOffered"
	/** Anything else, including a server error on a write. */
	| "failed";

/** Fixed text only: nothing typed, derived or stored ever lands in a message. */
export class KeyFlowError extends Error {
	constructor(readonly code: KeyFlowCode) {
		super(code);
		this.name = "KeyFlowError";
	}
}

/** "This account is keyed on this server", kept by the platform (secure storage on the phone, localStorage on the web). */
export interface KeyedRecord {
	/**
	 * Whether the account is recorded as keyed. A throw means the record cannot
	 * be read: the flow then refuses (fail closed). A platform whose store is
	 * only best effort (the web, where storage can be blocked) catches that
	 * itself and answers false.
	 */
	has(): Promise<boolean>;
	/** Records it. A throw makes a sign-in refuse; after a finished password change it is ignored. */
	set(): Promise<void>;
}

export interface FlowPorts {
	/** The primitives. Called only after the server's parameters passed, so a hostile answer never loads the library. */
	primitives(): Promise<Primitives>;
	/** Lets a busy state paint before Argon2id blocks the thread. */
	paint?(): Promise<void>;
	/**
	 * The account's kdf: prelogin when signed out, the keys route when signed in.
	 * Null is "no keys" (a null kdf or a missing route or account). Anything
	 * else that is not a clean answer throws KeyFlowError("rateLimited" or "unavailable").
	 */
	lookup(): Promise<Kdf | null>;
	record: KeyedRecord;
}

/** The shape of Kdf, checked by hand so a page does not load the contract's schemas. */
export function readKdf(value: unknown): Kdf | null {
	if (typeof value !== "object" || value === null) return null;
	const { salt, memoryKiB, passes } = value as Record<string, unknown>;
	return typeof salt === "string" &&
		Number.isInteger(memoryKiB) &&
		Number.isInteger(passes)
		? { salt, memoryKiB: memoryKiB as number, passes: passes as number }
		: null;
}

export const sameKdf = (a: Kdf, b: Kdf): boolean =>
	a.salt === b.salt && a.memoryKiB === b.memoryKiB && a.passes === b.passes;

/** The parameters, if they are inside the floor and ceiling (checked before any work). */
export function allowedParams(params: Argon2Params): Argon2Params {
	try {
		return checkArgon2Params({
			memoryKiB: params.memoryKiB,
			passes: params.passes,
		});
	} catch {
		throw new KeyFlowError("params");
	}
}

/** The salt bytes, if the text is base64url of exactly SALT_BYTES. */
export function readSalt(text: string): Uint8Array {
	const salt = fromBase64Url(text);
	if (salt?.length !== SALT_BYTES) throw new KeyFlowError("malformed");
	return salt;
}

/**
 * The code for a refused call, from its HTTP status and problem code (null
 * status: no answer at all). The one mapping both platforms use. A wrong
 * password is the 400 with `wrong_password` and nothing else.
 */
export function classifyRefusal(
	status: number | null,
	code: unknown,
): KeyFlowCode {
	if (status === null) return "unavailable";
	if (status === 429) return "rateLimited";
	if (status === 400 && code === "wrong_password") return "wrongPassword";
	if (status === 409) return "conflict";
	if (status === 501) return "notOffered";
	return "failed";
}

/** Anything a flow throws, as a KeyFlowError. */
export function asKeyFlowError(error: unknown): KeyFlowError {
	if (error instanceof KeyFlowError) return error;
	return new KeyFlowError(
		error instanceof CryptoError ? "malformed" : "failed",
	);
}

/** Keys that every exit of a flow wipes. */
export function secretBin(p: Pick<Primitives, "wipe">) {
	const held: Uint8Array[] = [];
	return {
		keep: (bytes: Uint8Array): Uint8Array => {
			held.push(bytes);
			return bytes;
		},
		wipeAll: () => {
			for (const bytes of held) p.wipe(bytes);
		},
	};
}
