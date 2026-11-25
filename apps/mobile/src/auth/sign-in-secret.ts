// The phone's side of "typed password to what the server checks". The flow
// itself (derive, the downgrade decision, changing the password of a keyed
// account) is @retrospend/crypto/client's, shared with the web; this file
// fills in its ports: the typed API client and its errors, the keystore
// record, the native primitives, and the words of the phone's results.
//
// Every prompt that sends a password (sign-in, deleting the account) goes
// through resolveSignInSecret, so none of them can send the typed password of
// a keyed account. The record "this email is keyed on this server" lives in
// secure storage; with it, a null answer, an error or a 404 is refused. Only
// an account the phone never saw keyed, against a server whose route is
// missing (404, an older server), falls back.
import type { RetrospendClient } from "@retrospend/api-client";
import { passwordMeetsRules } from "@retrospend/api-contract";
import type { Primitives } from "@retrospend/crypto";
import {
	accountIsKeyed,
	classifyRefusal,
	type FlowPorts,
	type KeyedRecord,
	type KeyFlowCode,
	KeyFlowError,
	type LookupRoute,
	type RotatePorts,
	rotatePassword as rotateKeyedPassword,
	signInSecretFor,
} from "@retrospend/crypto/client";
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

/**
 * How to ask for the account's KDF values: prelogin, or the keys route. `ask`
 * returns the server's answer unread; the shared core reads it, the same way
 * the web does.
 */
export type KdfLookup = { route: LookupRoute; ask: () => Promise<unknown> };

/** Signed in: GET /api/v1/me/protection/keys (404 when the account has none). */
export function keysLookup(api: RetrospendClient): KdfLookup {
	return { route: "keys", ask: () => api.protection.keys() };
}

export function statusOf(error: unknown): number | null {
	const status = (error as { status?: unknown } | null)?.status;
	return typeof status === "number" ? status : null;
}

/** The lookup as a port: a missing route (404) is `missing`, the answer is handed over unread. */
export function lookupPort(lookup: KdfLookup): FlowPorts["lookup"] {
	return async () => {
		try {
			return { body: await lookup.ask() };
		} catch (error) {
			const status = statusOf(error);
			if (status === 404) return { missing: true };
			throw new KeyFlowError(status === 429 ? "rateLimited" : "unavailable");
		}
	};
}

/** The "this email is keyed on this server" record, in the keystore. A store that cannot be read or written throws (the flows then refuse). */
export function keyedRecord(
	input: { baseUrl: string; email: string },
	deps: Pick<SecretDeps, "store">,
): KeyedRecord {
	return {
		has: async () =>
			(await deps.store.getItemAsync(
				keyedRecordKey(input.baseUrl, input.email),
			)) !== null,
		set: () => markKeyed(input.baseUrl, input.email, deps),
	};
}

function portsFor(
	input: { baseUrl: string; email: string; lookup: KdfLookup },
	deps: SecretDeps,
): FlowPorts {
	return {
		primitives: deps.primitives,
		lookup: lookupPort(input.lookup),
		lookupRoute: input.lookup.route,
		record: keyedRecord(input, deps),
	};
}

const SECRET_FAILURES: Record<KeyFlowCode, SecretFailure> = {
	downgrade: "keysMissing",
	rateLimited: "rateLimited",
	unavailable: "network",
	params: "protectionRefused",
	malformed: "protectionRefused",
	// The record cannot be read: nothing is sent.
	unreadable: "unknown",
	wrongPassword: "unknown",
	conflict: "unknown",
	notOffered: "unknown",
	// Enable and recovery codes: no sign-in or rotation call can produce them.
	wrongCode: "unknown",
	sessionNotFresh: "unknown",
	readBackFailed: "unknown",
	notFound: "unknown",
	serverError: "unknown",
	keyReused: "unknown",
	typo: "unknown",
	wrongRecoveryKey: "unknown",
	tokenExpired: "unknown",
	recoveryUnavailable: "unknown",
	unconfirmed: "unknown",
	failed: "unknown",
};

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
		return await accountIsKeyed(portsFor(input, deps));
	} catch {
		return null;
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
	try {
		const secret = await signInSecretFor(portsFor(input, deps), input.password);
		return { ok: true, secret };
	} catch (error) {
		const code = error instanceof KeyFlowError ? error.code : "failed";
		return { ok: false, reason: SECRET_FAILURES[code] };
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
	/** The new password breaks the rules: refused before anything is derived. */
	| "weakPassword"
	/** The server does not offer Advanced protection (501) any more. */
	| "unavailable"
	| "unknown";
export type RotateResult = { ok: true } | { ok: false; reason: RotateFailure };

const ROTATE_FAILURES: Record<KeyFlowCode, RotateFailure> = {
	wrongPassword: "wrongPassword",
	rateLimited: "rateLimited",
	unavailable: "network",
	downgrade: "keysMissing",
	params: "protectionRefused",
	malformed: "protectionRefused",
	conflict: "conflict",
	notOffered: "unavailable",
	unreadable: "unknown",
	// Enable and recovery codes: no rotation call can produce them.
	wrongCode: "unknown",
	sessionNotFresh: "unknown",
	readBackFailed: "unknown",
	notFound: "unknown",
	serverError: "unknown",
	keyReused: "unknown",
	typo: "unknown",
	wrongRecoveryKey: "unknown",
	tokenExpired: "unknown",
	recoveryUnavailable: "unknown",
	unconfirmed: "unknown",
	failed: "unknown",
};

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

/** A call's refusal as a KeyFlowError, from the problem's status and code only: server text is never used. */
export async function call<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		throw new KeyFlowError(
			classifyRefusal(
				statusOf(error),
				(error as { code?: unknown } | null)?.code,
			),
		);
	}
}

/** How long a request of the recovery, Make new key and enable flows may take before it counts as a lost answer. Argon2id is not in it. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Gives a request a time limit: the one place the phone bounds the network
 * part of the recovery, Make new key and enable flows (the client has no
 * timeout of its own, and Android's default read timeout is unlimited). A
 * request with no answer by then is aborted and rejects as `unavailable`, the
 * same as a lost connection. The late answer of an aborted request is ignored.
 * Every network call a locked sheet waits on goes through here (a test lists
 * the callers). A refusal is passed on as it came; `callWithTimeout` words it.
 */
export function withTimeout<T>(
	run: (options: { signal: AbortSignal }) => Promise<T>,
	ms: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const controller = new AbortController();
		const timer = setTimeout(() => {
			controller.abort();
			reject(new KeyFlowError("unavailable"));
		}, ms);
		run({ signal: controller.signal }).then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/** `withTimeout` for a call whose refusal becomes a KeyFlowError (`call`). */
export function callWithTimeout<T>(
	run: (options: { signal: AbortSignal }) => Promise<T>,
	ms: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
	return withTimeout((o) => call(() => run(o)), ms);
}

function rotatePorts(input: RotateInput, deps: SecretDeps): RotatePorts {
	return {
		...portsFor(input, deps),
		begin: (body) => call(() => input.api.beginPasswordRotation(body)),
		commit: async (body, idempotencyKey) => {
			await call(() =>
				input.api.rotatePassword(body, { context: { idempotencyKey } }),
			);
		},
		newKey: input.newKey,
	};
}

/**
 * Changes the password of an account with protection keys, on this phone (the
 * flow is @retrospend/crypto/client's). A conflict (the keys changed between
 * the two calls) starts over once with a new key; a second one is returned.
 * The account stays recorded as keyed.
 */
export async function rotatePassword(
	input: RotateInput,
	deps: Pick<SecretDeps, "primitives" | "store"> = defaultDeps,
): Promise<RotateResult> {
	// A keyed account's password is never sent, so the server cannot refuse a
	// weak one: this is the only place the rules are enforced for it.
	if (!passwordMeetsRules(input.next))
		return { ok: false, reason: "weakPassword" };
	try {
		await rotateKeyedPassword(rotatePorts(input, deps), {
			userId: input.userId,
			current: input.current,
			next: input.next,
		});
		return { ok: true };
	} catch (error) {
		const code = error instanceof KeyFlowError ? error.code : "failed";
		return { ok: false, reason: ROTATE_FAILURES[code] };
	}
}
