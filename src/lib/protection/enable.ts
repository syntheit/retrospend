// Turning on Advanced protection, the web's side: the sheet's two callbacks
// (makeKeys, save) over this browser's ports. The flow (make the keys, check
// them before sending, send, read them back with the digest, word every
// failure) is @retrospend/crypto/client's, shared with the phone; this file
// only asks the server, signs in again when the session is too old, and keeps
// the "this address is keyed" record. It throws KeyFlowError and nothing else.
import type {
	EnableCallbacks,
	EnablePorts,
	EnableSignInStep,
} from "@retrospend/crypto/client";
import { generateId } from "~/lib/id";
import {
	type Core,
	defaults,
	flowPorts,
	loadCore,
	post,
	refusal,
	type SignInSecretDeps,
	SignInSecretError,
	signInSecretFor,
} from "./sign-in-secret";

/** What signing in again needs from the auth client; the tests pass their own. */
export interface SessionRefresh {
	/** Email and sign-in secret sign-in. `twoFactor` means a code is asked next. */
	signIn(email: string, secret: string): Promise<EnableSignInStep>;
	verifyCode(code: string): Promise<EnableSignInStep>;
}

type AuthResult = {
	data: unknown;
	error: { status?: number } | null;
};

/** better-auth's answer as a sign-in step: 400 and 401 are the server saying no to what was typed. */
export function signInStepOf(result: AuthResult): EnableSignInStep {
	const status = result.error?.status;
	if (result.error) {
		return {
			status: "error",
			kind:
				status === undefined
					? "unreachable"
					: status === 429
						? "rateLimited"
						: status === 400 || status === 401
							? "rejected"
							: "other",
		};
	}
	return (result.data as { twoFactorRedirect?: boolean } | null)
		?.twoFactorRedirect
		? { status: "twoFactor" }
		: { status: "signedIn" };
}

/** better-auth's own client, loaded when a session has to be renewed. */
async function authClientRefresh(): Promise<SessionRefresh> {
	const { authClient } = await import("~/lib/auth-client");
	const run = async (
		go: () => Promise<AuthResult>,
	): Promise<EnableSignInStep> => {
		try {
			return signInStepOf(await go());
		} catch {
			return { status: "error", kind: "unreachable" };
		}
	};
	return {
		signIn: (email, secret) =>
			run(() => authClient.signIn.email({ email, password: secret })),
		verifyCode: (code) => run(() => authClient.twoFactor.verifyTotp({ code })),
	};
}

export type WebEnableDeps = SignInSecretDeps & {
	session?: SessionRefresh;
	newKey?: () => string;
};

export type WebEnableOptions = {
	deps?: Partial<WebEnableDeps>;
	/** Tests only: cheaper Argon2id parameters than the real ones. */
	params?: { memoryKiB: number; passes: number };
};

function ports(
	core: Core,
	deps: WebEnableDeps,
	account: { id: string; email: string },
): EnablePorts {
	const base = flowPorts(core, deps, account.email, true);
	const answer = async (path: string, body: unknown, key?: string) => {
		const wire = await post(core, deps, path, body, key);
		if (wire.status !== 200) throw refusal(core, wire);
		return wire.body;
	};
	let session: SessionRefresh | undefined;
	return {
		primitives: base.primitives,
		paint: base.paint,
		record: base.record,
		userId: account.id,
		newKey: deps.newKey ?? generateId,
		enable: async (body, key) => {
			await answer("/api/v1/me/protection/enable", body, key);
		},
		open: (body) => answer("/api/v1/me/protection/keys/open", body),
		signIn: async (password) => {
			let secret: string;
			try {
				// No keys yet, so this is the typed password; a device that holds the
				// keyed record is refused here, as everywhere (signInSecretFor).
				secret = await signInSecretFor(account.email, password, { deps });
			} catch (error) {
				const code = error instanceof SignInSecretError ? error.code : null;
				return {
					status: "error",
					kind:
						code === "rateLimited"
							? "rateLimited"
							: code === "unavailable"
								? "unreachable"
								: "other",
				};
			}
			session ??= deps.session ?? (await authClientRefresh());
			return session.signIn(account.email.trim().toLowerCase(), secret);
		},
		verifyCode: async (code) => {
			session ??= deps.session ?? (await authClientRefresh());
			return session.verifyCode(code);
		},
	};
}

/**
 * The enable sheet's callbacks for the signed-in account. One instance per
 * sheet: its drafts are remembered here, so `save` only takes a draft this
 * instance's `makeKeys` made.
 */
export function webEnableCallbacks(
	account: { id: string; email: string },
	options: WebEnableOptions = {},
): EnableCallbacks {
	const deps: WebEnableDeps = { ...defaults(), ...options.deps };
	let built: Promise<EnableCallbacks> | null = null;
	const callbacks = () => {
		built ??= loadCore()
			.then((core) =>
				core.createEnableCallbacks(
					ports(core, deps, account),
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
		makeKeys: (password) => callbacks().then((c) => c.makeKeys(password)),
		save: (draft, input) => callbacks().then((c) => c.save(draft, input)),
	};
}
