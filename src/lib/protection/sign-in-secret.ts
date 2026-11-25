// The text a web password prompt sends to the server as "the password", the
// web's side of it. The flow itself (derive, the downgrade decision, changing
// the password of a keyed account) is @retrospend/crypto/client's, shared
// with the phone; this file fills in its ports (fetch and its errors, the
// localStorage record, the WebAssembly primitives) and words the results.
// Every prompt that checks the password goes through here.
//
// An account without Advanced protection keys signs in with what was typed.
// An account with keys signs in with the auth key made from it (prelogin when
// signed out, the keys route when signed in).
//
// Downgrade: a server that answers "no keys" to an account that has them would
// get the typed password. After a keyed answer this browser remembers that
// the address is keyed, and from then on a null answer, an error or a missing
// route is refused. The record is best effort: it lives in localStorage, and a
// server that serves this very page can also serve a page that skips the check
// (spike 4.8). It stops a server that only controls the API answers, and an
// account's first sign-in on a new browser is not covered.
import { passwordMeetsRules } from "@retrospend/api-contract";
import type { Primitives } from "@retrospend/crypto";
import type {
	FlowPorts,
	KeyedRecord,
	RotatePorts,
} from "@retrospend/crypto/client";
import { generateId } from "~/lib/id";

export type SignInSecretFailure =
	| "unavailable"
	| "downgrade"
	| "params"
	| "rateLimited";

/** Fixed text only: nothing typed, derived or stored ever lands in a message. */
export class SignInSecretError extends Error {
	constructor(readonly code: SignInSecretFailure) {
		super(code);
		this.name = "SignInSecretError";
	}
}

export type SignInSecretDeps = {
	fetch: typeof fetch;
	/** Null where storage is blocked: the record is then neither read nor written. */
	storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
	/** Lets the busy state paint before Argon2id blocks the main thread. */
	paint: () => Promise<void>;
	/** The primitives (the WebAssembly build by default); the tests wrap them to corrupt or watch a step. */
	primitives?: () => Promise<Primitives>;
};

const KEYED_PREFIX = "rs.keyed.";
const REQUEST_TIMEOUT_MS = 15_000;

const normalizeEmail = (email: string) => email.trim().toLowerCase();

function browserStorage(): SignInSecretDeps["storage"] {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

const paintFrame = (): Promise<void> =>
	new Promise((resolve) => {
		const next = () => setTimeout(resolve, 0);
		if (typeof requestAnimationFrame === "function")
			requestAnimationFrame(next);
		else next();
	});

export const defaults = (): SignInSecretDeps => ({
	fetch: (input, init) => fetch(input, init),
	storage: browserStorage(),
	paint: paintFrame,
});

// The shared flow loads when a prompt runs, not with the page.
export const loadCore = () => import("@retrospend/crypto/client");
export type Core = Awaited<ReturnType<typeof loadCore>>;

export const webPrimitives = async () =>
	(await import("@retrospend/crypto/web")).createWebPrimitives();

/**
 * The storage key for an address: a SHA-256 of it, so the browser never holds
 * the address itself. Null where SubtleCrypto is missing (a page served over
 * plain http), which turns the record off.
 */
async function recordKey(email: string): Promise<string | null> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) return null;
	const digest = await subtle.digest(
		"SHA-256",
		new TextEncoder().encode(normalizeEmail(email)),
	);
	const hex = Array.from(new Uint8Array(digest), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
	return KEYED_PREFIX + hex;
}

/**
 * The record of "this address is keyed" in localStorage. Best effort on both
 * sides, unlike the phone's: storage is blocked in some private windows, and a
 * sign-in must still work there (the downgrade check is then off).
 */
function keyedRecord(deps: SignInSecretDeps, email: string): KeyedRecord {
	return {
		has: async () => {
			try {
				const key = await recordKey(email);
				return key !== null && deps.storage?.getItem(key) === "1";
			} catch {
				return false;
			}
		},
		set: async () => {
			try {
				const key = await recordKey(email);
				if (key !== null) deps.storage?.setItem(key, "1");
			} catch {
				// Only the downgrade check is lost.
			}
		},
	};
}

/**
 * Forgets that an address was keyed, for the person who says they reset the
 * password (a reset removes the keys while protection is off, and an address
 * that is still recorded would be refused for good). Then the next sign-in
 * takes whatever the server says.
 */
export async function forgetKeyed(
	email: string,
	deps: Partial<SignInSecretDeps> = {},
): Promise<void> {
	const { storage } = { ...defaults(), ...deps };
	try {
		const key = await recordKey(email);
		if (key !== null) storage?.removeItem(key);
	} catch {
		// Best effort, like the record itself.
	}
}

/**
 * Asks the server about the sign-in secret and hands the answer to the core
 * unread: a missing route or account (404) is `missing`, a rate limit or any
 * other failure throws "rateLimited" or "unavailable". What the body means is
 * the core's (lookupKdf), the same for the phone.
 */
function lookupPort(
	core: Core,
	deps: SignInSecretDeps,
	email: string,
	signedIn: boolean,
): FlowPorts["lookup"] {
	const fail = (code: "rateLimited" | "unavailable") =>
		new core.KeyFlowError(code);
	return async () => {
		let res: Response;
		try {
			const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
			res = signedIn
				? await deps.fetch("/api/v1/me/protection/keys", {
						credentials: "same-origin",
						headers: { accept: "application/json" },
						signal,
					})
				: await deps.fetch("/api/v1/auth/prelogin", {
						method: "POST",
						credentials: "same-origin",
						headers: {
							accept: "application/json",
							"content-type": "application/json",
						},
						body: JSON.stringify({ email: normalizeEmail(email) }),
						signal,
					});
		} catch {
			throw fail("unavailable");
		}
		if (res.status === 404) return { missing: true };
		if (res.status === 429) throw fail("rateLimited");
		if (!res.ok) throw fail("unavailable");
		try {
			return { body: await res.json() };
		} catch {
			throw fail("unavailable");
		}
	};
}

export function flowPorts(
	core: Core,
	deps: SignInSecretDeps,
	email: string,
	signedIn: boolean,
): FlowPorts {
	return {
		primitives: deps.primitives ?? webPrimitives,
		paint: deps.paint,
		lookup: lookupPort(core, deps, email, signedIn),
		lookupRoute: signedIn ? "keys" : "prelogin",
		record: keyedRecord(deps, email),
	};
}

/** Words a flow failure as a sign-in secret failure. */
function secretError(core: Core, error: unknown): SignInSecretError {
	const { code } = core.asKeyFlowError(error);
	return new SignInSecretError(
		code === "params" || code === "downgrade" || code === "rateLimited"
			? code
			: "unavailable",
	);
}

async function withCore<T>(
	run: (core: Core) => Promise<T>,
	fail: (core: Core, error: unknown) => Error,
): Promise<T> {
	let core: Core;
	try {
		core = await loadCore();
	} catch {
		throw new SignInSecretError("unavailable");
	}
	try {
		return await run(core);
	} catch (error) {
		throw fail(core, error);
	}
}

/**
 * The text to send as the password for `email`. `signedIn` takes the
 * parameters from the keys route (the session proves whose they are) instead
 * of prelogin. Throws SignInSecretError; the typed password is never sent
 * after a failure.
 */
export function signInSecretFor(
	email: string,
	password: string,
	options: { signedIn?: boolean; deps?: Partial<SignInSecretDeps> } = {},
): Promise<string> {
	const deps = { ...defaults(), ...options.deps };
	return withCore(
		(core) =>
			core.signInSecretFor(
				flowPorts(core, deps, email, options.signedIn === true),
				password,
			),
		secretError,
	);
}

/**
 * Whether the signed-in account has protection keys, for a prompt that must
 * not send a typed password at all for such an account (password change).
 * True too when this browser remembers the address as keyed and the server now
 * says otherwise: sending nothing is the safe answer there. Throws
 * SignInSecretError when the server cannot be asked.
 */
export function accountIsKeyed(
	email: string,
	options: { deps?: Partial<SignInSecretDeps> } = {},
): Promise<boolean> {
	const deps = { ...defaults(), ...options.deps };
	return withCore(
		(core) => core.accountIsKeyed(flowPorts(core, deps, email, true)),
		secretError,
	);
}

export type RotationFailure =
	| "wrongPassword"
	| "rateLimited"
	| "conflict"
	| "notOffered"
	| "params"
	| "downgrade"
	| "unavailable"
	/** The new password breaks the rules: refused before anything is derived. */
	| "weakPassword";

/** Fixed text only, like SignInSecretError: no key, secret or typed text in a message. */
export class PasswordRotationError extends Error {
	constructor(readonly code: RotationFailure) {
		super(code);
		this.name = "PasswordRotationError";
	}
}

export type Wire = { status: number; body: unknown };

const asObject = (v: unknown): Record<string, unknown> =>
	typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

export async function post(
	core: Core,
	deps: SignInSecretDeps,
	path: string,
	body: unknown,
	idempotencyKey?: string,
): Promise<Wire> {
	try {
		const res = await deps.fetch(path, {
			method: "POST",
			credentials: "same-origin",
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		return { status: res.status, body: await res.json().catch(() => null) };
	} catch {
		throw new core.KeyFlowError("unavailable");
	}
}

/** The stable code of a refused answer; raw text from the server is never used. */
export const refusal = (core: Core, { status, body }: Wire) =>
	new core.KeyFlowError(core.classifyRefusal(status, asObject(body).code));

/**
 * The ports of a password change: the keys route, the two commit routes, the
 * record and the primitives. Exported for this file's tests, which run the
 * shared flow with cheaper parameters than the public function may.
 */
export function rotationPorts(
	core: Core,
	deps: SignInSecretDeps,
	email: string,
): RotatePorts {
	return {
		...flowPorts(core, deps, email, true),
		begin: async (body) => {
			const begin = await post(
				core,
				deps,
				"/api/v1/me/protection/password/begin",
				body,
			);
			if (begin.status !== 200) throw refusal(core, begin);
			return begin.body;
		},
		commit: async (body, idempotencyKey) => {
			const commit = await post(
				core,
				deps,
				"/api/v1/me/protection/password",
				body,
				idempotencyKey,
			);
			if (commit.status !== 200) throw refusal(core, commit);
		},
		newKey: generateId,
	};
}

/** Words a flow failure as a password change failure. */
export function rotationError(
	core: Core,
	error: unknown,
): PasswordRotationError {
	const { code } = core.asKeyFlowError(error);
	return new PasswordRotationError(
		code === "wrongPassword" ||
			code === "rateLimited" ||
			code === "conflict" ||
			code === "notOffered" ||
			code === "params" ||
			code === "downgrade"
			? code
			: "unavailable",
	);
}

/**
 * Changes the password of the signed-in account that has keys, entirely in
 * the browser: the server only ever sees the two sign-in secrets and the
 * rewrapped account key. A `conflict` (the keys changed under it) starts the
 * whole run again once, with a new Idempotency-Key (the shared flow's rule).
 * Throws PasswordRotationError.
 */
export async function rotatePassword(
	userId: string,
	email: string,
	current: string,
	next: string,
	options: { deps?: Partial<SignInSecretDeps> } = {},
): Promise<void> {
	// A keyed account's password is never sent, so the server cannot refuse a
	// weak one: this is the only place the rules are enforced for it.
	if (!passwordMeetsRules(next))
		throw new PasswordRotationError("weakPassword");
	const deps: SignInSecretDeps = { ...defaults(), ...options.deps };
	let core: Core;
	try {
		core = await loadCore();
	} catch {
		throw new PasswordRotationError("unavailable");
	}
	try {
		await core.rotatePassword(rotationPorts(core, deps, email), {
			userId,
			current,
			next,
		});
	} catch (error) {
		throw rotationError(core, error);
	}
}
