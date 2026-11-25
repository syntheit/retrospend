// Recovering an account with the recovery key, the web's side: the reset link
// check and the recovery callbacks' ports (begin, check, commit) over this
// browser's fetch. The flow (prove the key before a new password is asked for,
// make and check the new wraps, settle a lost commit by the link check, word
// every failure) is @retrospend/crypto/client's, shared with the phone; this
// file only asks the server and holds the reset token. It throws KeyFlowError
// and nothing else.
import type {
	RecoveryCallbacks,
	RecoveryFlowPorts,
} from "@retrospend/crypto/client";
import {
	type Core,
	defaults,
	loadCore,
	post,
	refusal,
	type SignInSecretDeps,
	webPrimitives,
} from "./sign-in-secret";

const CHECK = "/api/v1/auth/recovery/check";
const BEGIN = "/api/v1/auth/recovery/begin";
const COMMIT = "/api/v1/auth/recovery";

/** What a reset link leads to (the check route's answer, read by hand). */
export type RecoveryLink = {
	keys: "none" | "recovery" | "noRecovery";
	protectionOn: boolean;
};

/**
 * Asks what the link leads to. `invalid` is the link being unknown, spent,
 * expired or made by an admin (one answer for all). Throws KeyFlowError
 * (`unavailable`, `rateLimited`) when the question could not be answered, and
 * for an answer of another shape: the page then offers Retry, and never shows
 * the plain reset form on a guess.
 */
export async function checkRecoveryLink(
	token: string,
	options: { deps?: Partial<SignInSecretDeps> } = {},
): Promise<RecoveryLink | "invalid"> {
	const deps = { ...defaults(), ...options.deps };
	const core = await loadCore();
	const wire = await post(core, deps, CHECK, { token });
	if (wire.status === 404) return "invalid";
	if (wire.status !== 200) throw refusal(core, wire);
	const { keys, protectionOn } = (
		typeof wire.body === "object" && wire.body !== null ? wire.body : {}
	) as Record<string, unknown>;
	if (
		(keys !== "none" && keys !== "recovery" && keys !== "noRecovery") ||
		typeof protectionOn !== "boolean"
	)
		throw new core.KeyFlowError("unavailable");
	return { keys, protectionOn };
}

function ports(
	core: Core,
	deps: SignInSecretDeps,
	token: string,
): RecoveryFlowPorts {
	const answer = async (path: string, body: Record<string, unknown>) => {
		const wire = await post(core, deps, path, { token, ...body });
		if (wire.status !== 200) throw refusal(core, wire);
		return wire.body;
	};
	return {
		primitives: deps.primitives ?? webPrimitives,
		paint: deps.paint,
		begin: (body) => answer(BEGIN, body),
		check: async () => {
			await answer(CHECK, {});
		},
		commit: async (body) => {
			await answer(COMMIT, body);
		},
	};
}

export type WebRecoveryOptions = {
	deps?: Partial<SignInSecretDeps>;
	/** Tests only: cheaper Argon2id parameters than the real ones. */
	params?: { memoryKiB: number; passes: number };
};

/**
 * The recovery sheet's callbacks for one reset link. One instance per sheet:
 * its handles are remembered here, so `finish` only takes a handle this
 * instance's `begin` made.
 */
export function webRecoveryCallbacks(
	token: string,
	options: WebRecoveryOptions = {},
): RecoveryCallbacks {
	const deps: SignInSecretDeps = { ...defaults(), ...options.deps };
	let built: Promise<RecoveryCallbacks> | null = null;
	const callbacks = () => {
		built ??= loadCore()
			.then((core) =>
				core.createRecoveryCallbacks(
					ports(core, deps, token),
					options.params ? { params: options.params } : undefined,
				),
			)
			.catch((error: unknown) => {
				// A script that failed to load is tried again, not remembered.
				built = null;
				throw error;
			});
		return built;
	};
	return {
		begin: (keyText) => callbacks().then((c) => c.begin(keyText)),
		finish: (handle, input) => callbacks().then((c) => c.finish(handle, input)),
	};
}
