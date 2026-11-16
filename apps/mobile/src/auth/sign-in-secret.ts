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
import type { RetrospendClient } from "@retrospend/api-client";
import type { PreloginKdf } from "@retrospend/api-contract";
import {
	CryptoError,
	checkArgon2Params,
	deriveMasterKey,
	fromBase64Url,
	masterSubkeys,
	type Primitives,
	signInSecret,
} from "@retrospend/crypto";
import { getPrimitives } from "@/crypto/native";
import { originOf, sha256Hex } from "@/lib/origin-key";
import { secureStore } from "@/lib/secure-store";

export type SecretFailure = "network" | "protectionRefused" | "unknown";
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
		if (recorded) {
			return {
				ok: false,
				reason: statusOf(error) === 404 ? "protectionRefused" : "network",
			};
		}
		// An older server has no route: the account cannot have keys.
		if (statusOf(error) === 404) return { ok: true, secret: password };
		return { ok: false, reason: "network" };
	}

	if (kdf === null) {
		return recorded
			? { ok: false, reason: "protectionRefused" }
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
