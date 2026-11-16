// The text a web password prompt sends to the server as "the password".
// An account without Advanced protection keys signs in with what was typed.
// An account with keys signs in with the auth key made from it: Argon2id with
// the account's salt and parameters (prelogin when signed out, the keys route
// when signed in), then the auth key as base64url (signInSecret). This is the
// one place the web does that, so every prompt that checks the password goes
// through here.
//
// Downgrade: a server that answers "no keys" to an account that has them would
// get the typed password. After a keyed answer this browser remembers that
// the address is keyed, and from then on a null answer, an error or a missing
// route is refused. The record is best effort: it lives in localStorage, and a
// server that serves this very page can also serve a page that skips the check
// (spike 4.8). It stops a server that only controls the API answers, and an
// account's first sign-in on a new browser is not covered.
import type { PreloginKdf } from "@retrospend/api-contract";

export type SignInSecretFailure = "unavailable" | "downgrade" | "params";

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

const defaults = (): SignInSecretDeps => ({
	fetch: (input, init) => fetch(input, init),
	storage: browserStorage(),
	paint: paintFrame,
});

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

async function isRecorded(
	deps: SignInSecretDeps,
	email: string,
): Promise<boolean> {
	try {
		const key = await recordKey(email);
		return key !== null && deps.storage?.getItem(key) === "1";
	} catch {
		return false;
	}
}

async function record(deps: SignInSecretDeps, email: string): Promise<void> {
	try {
		const key = await recordKey(email);
		if (key !== null) deps.storage?.setItem(key, "1");
	} catch {
		// Best effort: a blocked or full store only loses the downgrade check.
	}
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

type Answer = { kdf: PreloginKdf } | null;

/** The shape of PreloginKdf, checked by hand so the page does not load the contract's schemas. */
function readKdf(value: unknown): PreloginKdf | null {
	if (typeof value !== "object" || value === null) return null;
	const { salt, memoryKiB, passes } = value as Record<string, unknown>;
	return typeof salt === "string" &&
		Number.isInteger(memoryKiB) &&
		Number.isInteger(passes)
		? { salt, memoryKiB: memoryKiB as number, passes: passes as number }
		: null;
}

/**
 * What the server says about the sign-in secret. Null is "no keys" (a null
 * kdf, or a missing route or account). Anything else that is not a clean
 * answer is "unavailable".
 */
async function ask(
	deps: SignInSecretDeps,
	email: string,
	signedIn: boolean,
): Promise<Answer> {
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
		throw new SignInSecretError("unavailable");
	}
	if (res.status === 404) return null;
	if (!res.ok) throw new SignInSecretError("unavailable");
	let body: unknown;
	try {
		body = await res.json();
	} catch {
		throw new SignInSecretError("unavailable");
	}
	const raw = (body as { kdf?: unknown } | null)?.kdf;
	// Prelogin says null for "no keys"; the keys route has no such answer.
	if (raw === null && !signedIn) return null;
	const kdf = readKdf(raw);
	if (!kdf) throw new SignInSecretError("unavailable");
	return { kdf };
}

async function derive(
	deps: SignInSecretDeps,
	password: string,
	kdf: PreloginKdf,
): Promise<string> {
	// The shared package loads here and the WebAssembly build after the
	// parameters pass, so a plain account never downloads libsodium and a
	// hostile answer never reaches it.
	const lib = await import("@retrospend/crypto");
	const params = { memoryKiB: kdf.memoryKiB, passes: kdf.passes };
	try {
		lib.checkArgon2Params(params);
	} catch {
		throw new SignInSecretError("params");
	}
	const salt = lib.fromBase64Url(kdf.salt);
	if (salt?.length !== 16) throw new SignInSecretError("unavailable");
	const { createWebPrimitives } = await import("@retrospend/crypto/web");
	const p = await createWebPrimitives();
	await deps.paint();
	const master = lib.deriveMasterKey(p, password, salt, params);
	const { authKey, wrapKey } = lib.masterSubkeys(p, master);
	const secret = lib.signInSecret(authKey);
	p.wipe(master);
	p.wipe(authKey);
	p.wipe(wrapKey);
	return secret;
}

/**
 * The text to send as the password for `email`. `signedIn` takes the
 * parameters from the keys route (the session proves whose they are) instead
 * of prelogin. Throws SignInSecretError; the typed password is never sent
 * after a failure.
 */
export async function signInSecretFor(
	email: string,
	password: string,
	options: { signedIn?: boolean; deps?: Partial<SignInSecretDeps> } = {},
): Promise<string> {
	const deps = { ...defaults(), ...options.deps };
	const answer = await ask(deps, email, options.signedIn === true);
	if (!answer) {
		if (await isRecorded(deps, email)) throw new SignInSecretError("downgrade");
		return password;
	}
	await record(deps, email);
	try {
		return await derive(deps, password, answer.kdf);
	} catch (e) {
		if (e instanceof SignInSecretError) throw e;
		throw new SignInSecretError("unavailable");
	}
}
