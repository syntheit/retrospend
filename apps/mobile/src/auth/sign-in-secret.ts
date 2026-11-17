// The one place that turns a typed password into what the server checks.
//
// An account without Advanced protection keys signs in with the typed
// password. An account with keys signs in with its sign-in secret: Argon2id
// over the password with the account's salt and parameters (prelogin when
// signed out, GET /me/protection/keys when signed in), then the auth key as
// base64url. Every prompt that sends a password (sign-in, deleting the
// account) goes through here, so none of them can send the typed password of
// a keyed account.
//
// Downgrade defense: a server that is hostile, or one that lost the key set,
// could answer "no keys" and make the app send the typed password. So once
// this phone has seen the email keyed on this server (a keyed answer, or the
// enable flow), it records that in secure storage and from then on refuses a
// null answer, an error or a 404. Only an account the phone never saw keyed,
// against a server whose route is missing (404, an older server), falls back.
//
// Changing the password of a keyed account (rotatePassword, at the end) is the
// other derive: the old and the new password both turn into a sign-in secret
// and the account key is rewrapped under the new one, all on this phone.
import type { RetrospendClient } from "@retrospend/api-client";
import type { PreloginKdf } from "@retrospend/api-contract";
import {
	ARGON2_DEFAULT,
	CryptoError,
	checkArgon2Params,
	deriveMasterKey,
	fromBase64Url,
	masterSubkeys,
	type Primitives,
	SALT_BYTES,
	signInSecret,
	toBase64Url,
	unwrapKey,
	wrapKey,
} from "@retrospend/crypto";
import { getPrimitives } from "@/crypto/native";
import { originOf, sha256Hex } from "@/lib/origin-key";
import { secureStore } from "@/lib/secure-store";

// "keysMissing" is the one refusal a person can act on: a recorded account that
// the server now says has no keys (a reset removed them). Everything else
// (errors, bad parameters) stays refused with no way around it.
export type SecretFailure =
	| "network"
	| "rateLimited"
	| "protectionRefused"
	| "keysMissing"
	| "unknown";
export type SecretResult =
	| { ok: true; secret: string }
	| { ok: false; reason: SecretFailure };

/** The small part of the keystore this needs. */
export interface KeyedStore {
	getItemAsync(key: string): Promise<string | null>;
	setItemAsync(key: string, value: string): Promise<void>;
	deleteItemAsync(key: string): Promise<void>;
}

export interface SecretDeps {
	store: KeyedStore;
	primitives: () => Promise<Primitives>;
}

const defaultDeps: SecretDeps = {
	store: secureStore,
	primitives: getPrimitives,
};

/**
 * The keystore key for "this email is keyed on this server": a hash of the
 * server origin and the lowercased email, so the address itself is never
 * written. SecureStore keys allow letters, digits, ".", "-" and "_".
 */
export function keyedRecordKey(baseUrl: string, email: string): string {
	const id = sha256Hex(`${originOf(baseUrl)}\n${email.trim().toLowerCase()}`);
	return `retrospend_keyed_${id.slice(0, 32)}`;
}

/** Record that this email has keys on this server (after a keyed answer or enable). */
export async function markKeyed(
	baseUrl: string,
	email: string,
	deps: Pick<SecretDeps, "store"> = defaultDeps,
): Promise<void> {
	await deps.store.setItemAsync(keyedRecordKey(baseUrl, email), "1");
}

/** Forget the record, for an account that was deleted. */
export async function forgetKeyed(
	baseUrl: string,
	email: string,
	deps: Pick<SecretDeps, "store"> = defaultDeps,
): Promise<void> {
	await deps.store.deleteItemAsync(keyedRecordKey(baseUrl, email));
}

/** How to read the account's KDF values: prelogin, or the keys route. */
export type KdfLookup = () => Promise<PreloginKdf | null>;

/** Signed in: GET /api/v1/me/protection/keys (404 when the account has none). */
export function keysLookup(api: RetrospendClient): KdfLookup {
	return async () => (await api.protection.keys()).kdf;
}

function statusOf(error: unknown): number | null {
	const status = (error as { status?: unknown } | null)?.status;
	return typeof status === "number" ? status : null;
}

async function derive(
	p: Primitives,
	password: string,
	kdf: PreloginKdf,
): Promise<string | null> {
	const salt = fromBase64Url(kdf.salt);
	if (!salt) return null;
	const params = checkArgon2Params({
		memoryKiB: kdf.memoryKiB,
		passes: kdf.passes,
	});
	const master = deriveMasterKey(p, password, salt, params);
	const { authKey, wrapKey } = masterSubkeys(p, master);
	const secret = signInSecret(authKey);
	for (const key of [master, authKey, wrapKey]) p.wipe(key);
	return secret;
}

/**
 * Whether sending the typed password for this account would be wrong: true
 * when this phone recorded it as keyed or the keys route says it has keys
 * (then it is recorded too), false when the server says it has none, null when
 * that cannot be told (an error): the caller sends nothing in that case.
 * For prompts that must never send a keyed account's typed password and have
 * no secret to send instead (the password change is refused by the server).
 */
export async function isKeyedAccount(
	input: { baseUrl: string; email: string; lookup: KdfLookup },
	deps: SecretDeps = defaultDeps,
): Promise<boolean | null> {
	try {
		const key = keyedRecordKey(input.baseUrl, input.email);
		if ((await deps.store.getItemAsync(key)) !== null) return true;
		const kdf = await input.lookup();
		if (kdf === null) return false;
		await markKeyed(input.baseUrl, input.email, deps);
		return true;
	} catch (error) {
		return statusOf(error) === 404 ? false : null;
	}
}

/**
 * The text to send as the password for `email` on `baseUrl`. Never logs or
 * stores the password, the secret or the email (only the hashed record).
 */
export async function resolveSignInSecret(
	input: {
		baseUrl: string;
		email: string;
		password: string;
		lookup: KdfLookup;
	},
	deps: SecretDeps = defaultDeps,
): Promise<SecretResult> {
	const { baseUrl, email, password } = input;
	// Nothing to derive; the server refuses an empty password either way.
	if (password === "") return { ok: true, secret: password };

	let recorded: boolean;
	try {
		recorded =
			(await deps.store.getItemAsync(keyedRecordKey(baseUrl, email))) !== null;
	} catch {
		// Without the record the defense cannot work: do not send anything.
		return { ok: false, reason: "unknown" };
	}

	let kdf: PreloginKdf | null;
	try {
		kdf = await input.lookup();
	} catch (error) {
		const code = statusOf(error);
		if (recorded) {
			return {
				ok: false,
				reason:
					code === 404
						? "keysMissing"
						: code === 429
							? "rateLimited"
							: "network",
			};
		}
		// An older server has no route: the account cannot have keys.
		if (code === 404) return { ok: true, secret: password };
		return { ok: false, reason: code === 429 ? "rateLimited" : "network" };
	}

	if (kdf === null) {
		return recorded
			? { ok: false, reason: "keysMissing" }
			: { ok: true, secret: password };
	}

	try {
		const secret = await derive(await deps.primitives(), password, kdf);
		if (secret === null) return { ok: false, reason: "protectionRefused" };
		await markKeyed(baseUrl, email, deps);
		return { ok: true, secret };
	} catch (error) {
		return {
			ok: false,
			reason:
				error instanceof CryptoError && error.code === "invalid_input"
					? "protectionRefused"
					: "unknown",
		};
	}
}

/** Why a password change for a keyed account did not happen. */
export type RotateFailure =
	| "wrongPassword"
	| "rateLimited"
	| "network"
	| "keysMissing"
	| "protectionRefused"
	| "conflict"
	| "unknown";
export type RotateResult = { ok: true } | { ok: false; reason: RotateFailure };

/** The two routes a rotation calls. */
export type RotateApi = Pick<
	RetrospendClient["protection"],
	"beginPasswordRotation" | "rotatePassword"
>;

export interface RotateInput {
	api: RotateApi;
	baseUrl: string;
	email: string;
	/** The account id: the wrap is bound to it. */
	userId: string;
	current: string;
	next: string;
	lookup: KdfLookup;
	/** A fresh Idempotency-Key for each commit. */
	newKey: () => string;
}

/** A refusal with its reason; never carries text from the server. */
class RotateStop extends Error {
	constructor(readonly reason: RotateFailure) {
		super(reason);
	}
}

const stop = (reason: RotateFailure): never => {
	throw new RotateStop(reason);
};

/** The call's refusal as a reason, from the problem's status and code. */
function reasonOf(error: unknown): RotateFailure {
	const status = statusOf(error);
	if (status === null) return "network";
	if (status === 429) return "rateLimited";
	if (status === 409) return "conflict";
	const code = (error as { code?: unknown } | null)?.code;
	if (status === 400 && code === "wrong_password") return "wrongPassword";
	return "unknown";
}

async function call<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		return stop(reasonOf(error));
	}
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	return diff === 0;
}

/** One pass of the whole flow. Every key it makes is wiped before it returns. */
async function rotateOnce(input: RotateInput, p: Primitives): Promise<void> {
	const owned: Uint8Array[] = [];
	const keep = (bytes: Uint8Array): Uint8Array => {
		owned.push(bytes);
		return bytes;
	};
	const subkeys = (password: string, salt: Uint8Array, kdf: PreloginKdf) => {
		const master = keep(
			deriveMasterKey(
				p,
				password,
				salt,
				checkArgon2Params({ memoryKiB: kdf.memoryKiB, passes: kdf.passes }),
			),
		);
		const keys = masterSubkeys(p, master);
		keep(keys.authKey);
		keep(keys.wrapKey);
		return keys;
	};
	try {
		let kdf: PreloginKdf | null;
		try {
			kdf = await input.lookup();
		} catch (error) {
			return stop(statusOf(error) === 404 ? "keysMissing" : reasonOf(error));
		}
		if (kdf === null) return stop("keysMissing");
		const salt = fromBase64Url(kdf.salt) ?? stop("protectionRefused");

		const old = subkeys(input.current, salt, kdf);
		const currentAuthKey = signInSecret(old.authKey);
		const begun = await call(() =>
			input.api.beginPasswordRotation({ currentAuthKey }),
		);
		// The server proved the hash for this salt and these parameters; an
		// answer with others is not the key set the secret was made for.
		if (
			begun.kdf.salt !== kdf.salt ||
			begun.kdf.memoryKiB !== kdf.memoryKiB ||
			begun.kdf.passes !== kdf.passes
		)
			stop("protectionRefused");
		// The proof passed, so a wrap that does not open is corrupt or swapped.
		const wrap =
			fromBase64Url(begun.wrappedAccountKey) ?? stop("protectionRefused");
		const accountKey = keep(
			unwrapKey(p, old.wrapKey, "ak-password", input.userId, wrap),
		);

		const newSalt = keep(p.randomBytes(SALT_BYTES));
		const newKdf: PreloginKdf = {
			salt: toBase64Url(newSalt),
			memoryKiB: ARGON2_DEFAULT.memoryKiB,
			passes: ARGON2_DEFAULT.passes,
		};
		const fresh = subkeys(input.next, newSalt, newKdf);
		const newAuthKey = signInSecret(fresh.authKey);
		const wrappedAccountKey = toBase64Url(
			wrapKey(p, fresh.wrapKey, "ak-password", input.userId, accountKey),
		);

		// Check what is about to be sent, from the sent text, derived again:
		// the wrap must open with the new password to the same account key, and
		// the secret must be the one the new password makes. A mismatch would
		// lock the account out for good, so nothing is sent.
		const sentSalt = fromBase64Url(newKdf.salt) ?? stop("protectionRefused");
		const sentWrap =
			fromBase64Url(wrappedAccountKey) ?? stop("protectionRefused");
		const again = subkeys(input.next, sentSalt, newKdf);
		let opened: Uint8Array;
		try {
			opened = keep(
				unwrapKey(p, again.wrapKey, "ak-password", input.userId, sentWrap),
			);
		} catch {
			return stop("protectionRefused");
		}
		if (
			!sameBytes(opened, accountKey) ||
			signInSecret(again.authKey) !== newAuthKey
		)
			stop("protectionRefused");

		await call(() =>
			input.api.rotatePassword(
				{
					currentAuthKey,
					newAuthKey,
					kdf: newKdf,
					wrappedAccountKey,
					baseVersion: begun.version,
				},
				{ context: { idempotencyKey: input.newKey() } },
			),
		);
	} finally {
		for (const bytes of owned) p.wipe(bytes);
	}
}

/**
 * Changes the password of an account with protection keys, on this phone: the
 * server only ever sees the two sign-in secrets and the rewrapped account key.
 * A conflict (the keys changed between the two calls) starts over once with a
 * new key; a second one is returned. The account stays recorded as keyed.
 */
export async function rotatePassword(
	input: RotateInput,
	deps: Pick<SecretDeps, "primitives" | "store"> = defaultDeps,
): Promise<RotateResult> {
	try {
		const p = await deps.primitives();
		try {
			await rotateOnce(input, p);
		} catch (error) {
			if (!(error instanceof RotateStop) || error.reason !== "conflict")
				throw error;
			await rotateOnce(input, p);
		}
	} catch (error) {
		if (error instanceof RotateStop) return { ok: false, reason: error.reason };
		return {
			ok: false,
			reason: error instanceof CryptoError ? "protectionRefused" : "unknown",
		};
	}
	// The change is done; a failed write of the record must not say otherwise.
	await markKeyed(input.baseUrl, input.email, deps).catch(() => undefined);
	return { ok: true };
}
