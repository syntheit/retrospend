// What the web and the phone share when a typed password becomes keys: the
// error, the ports a platform fills in, and the reading of what a server says.
// Each platform keeps only its adapter (how to ask the server, where the
// "this account is keyed" record lives, which primitives to use, how its own
// errors are worded). Nothing here touches the network, storage or a screen.
import { fromBase64Url } from "../base64url";
import { CryptoError } from "../errors";
import {
	ARGON2_DEFAULT,
	checkArgon2Params,
	masterSubkeys,
	type SymmetricRole,
	unwrapKey,
} from "../keys";
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
	/** The two-factor code was refused, or one is required and was not sent. */
	| "wrongCode"
	/** The server wants a sign-in made in the last minutes before it changes the keys. */
	| "sessionNotFresh"
	/** The keys were saved, but what the server holds does not read back as what was sent. */
	| "readBackFailed"
	/** The recovery key text is not a key (a typo, a wrong length or a stray character). Nothing was sent. */
	| "typo"
	/** The recovery key's proof was refused (a key of another account, or an old one). */
	| "wrongRecoveryKey"
	/** The reset link is unknown, used or expired. */
	| "tokenExpired"
	/** This account has no recovery proof on the server (keys made before it existed). */
	| "recoveryUnavailable"
	/** The key set changed under the run (a second run may succeed). */
	| "conflict"
	/** The server answered 404 not_found: the thing asked about is not there (no key set). */
	| "notFound"
	/** The server failed (a 5xx, a gateway among them): a write may or may not have committed. */
	| "serverError"
	/** The Idempotency-Key was already used for another request body (422). */
	| "keyReused"
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

/** Which route a lookup asks: prelogin (signed out, may say "no keys" with a null kdf) or the keys route (signed in, always a kdf). */
export type LookupRoute = "prelogin" | "keys";

/**
 * What a lookup port hands the core: the raw JSON the server answered, or
 * `missing` for a missing route or account (a 404). The core reads it
 * (lookupKdf), so the web and the phone treat the same answer the same way.
 */
export type LookupAnswer =
	| { missing: true }
	| { missing?: false; body: unknown };

export interface FlowPorts {
	/** The primitives. Called only after the server's parameters passed, so a hostile answer never loads the library. */
	primitives(): Promise<Primitives>;
	/** Lets a busy state paint before Argon2id blocks the thread. */
	paint?(): Promise<void>;
	/**
	 * Asks the server for the account's kdf: prelogin when signed out, the keys
	 * route when signed in. Returns the answer unread. A refusal or a failure
	 * to reach the server throws KeyFlowError("rateLimited" or "unavailable").
	 */
	lookup(): Promise<LookupAnswer>;
	lookupRoute: LookupRoute;
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

/**
 * The account's kdf from the lookup port: null is "no keys" (a missing route
 * or account, or a null kdf from prelogin). An answer of any other shape,
 * including a null kdf from the keys route, is "unavailable", never "no keys".
 */
export async function lookupKdf(
	ports: Pick<FlowPorts, "lookup" | "lookupRoute">,
): Promise<Kdf | null> {
	const answer = await ports.lookup();
	if (answer.missing) return null;
	const raw = (answer.body as { kdf?: unknown } | null)?.kdf;
	if (raw === null && ports.lookupRoute === "prelogin") return null;
	const kdf = readKdf(raw);
	if (!kdf) throw new KeyFlowError("unavailable");
	return kdf;
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
	if (
		status === 400 &&
		(code === "wrong_two_factor_code" || code === "two_factor_required")
	)
		return "wrongCode";
	if (status === 403 && code === "session_not_fresh") return "sessionNotFresh";
	if (status === 400 && code === "wrong_recovery_key")
		return "wrongRecoveryKey";
	if (status === 404 && code === "invalid_token") return "tokenExpired";
	if (status === 404 && code === "not_found") return "notFound";
	if (status === 409 && code === "recovery_unavailable")
		return "recoveryUnavailable";
	if (status === 409) return "conflict";
	if (status === 501) return "notOffered";
	if (status === 422 && code === "idempotency_key_reused") return "keyReused";
	if (status >= 500) return "serverError";
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

/** The master key's two subkeys, all three kept in `bin` so every exit wipes them. */
export function binMasterSubkeys(
	p: Primitives,
	bin: ReturnType<typeof secretBin>,
	master: Uint8Array,
) {
	const k = masterSubkeys(p, bin.keep(master));
	return { authKey: bin.keep(k.authKey), wrapKey: bin.keep(k.wrapKey) };
}

/**
 * The base64url wrap of one role in a list a server answered (`{ role, wrapped }`
 * items), unread until now. The list must hold exactly one of the role; any
 * other shape is "unavailable" and nothing is derived from it. Other roles in
 * the list are ignored.
 */
export function findWrap(wraps: unknown, role: SymmetricRole): string {
	const found = Array.isArray(wraps)
		? wraps.filter(
				(w): w is { role: string; wrapped: unknown } =>
					typeof w === "object" && w !== null && w.role === role,
			)
		: [];
	const [only] = found;
	if (found.length !== 1 || typeof only?.wrapped !== "string")
		throw new KeyFlowError("unavailable");
	return only.wrapped;
}

export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => {
	let diff = a.length ^ b.length;
	for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	return diff === 0;
};

/**
 * The one check before sending: the wrap as it will be sent (base64url text)
 * must open under the wrapping key, for this role and id, to exactly the key
 * it was made from. Anything else is `malformed` and nothing goes out, so a
 * wrap that could lock the person out never reaches the server. Returns the
 * opened key, kept in `bin`. Enable, rotate, recover and new-key all use it.
 */
export function checkOpens(
	p: Primitives,
	bin: ReturnType<typeof secretBin>,
	check: {
		wrappingKey: Uint8Array;
		role: SymmetricRole;
		id: string;
		sent: string;
		expected: Uint8Array;
	},
): Uint8Array {
	const wrapped = fromBase64Url(check.sent);
	if (!wrapped) throw new KeyFlowError("malformed");
	let opened: Uint8Array;
	try {
		opened = bin.keep(
			unwrapKey(p, check.wrappingKey, check.role, check.id, wrapped),
		);
	} catch {
		throw new KeyFlowError("malformed");
	}
	if (!sameBytes(opened, check.expected)) throw new KeyFlowError("malformed");
	return opened;
}
