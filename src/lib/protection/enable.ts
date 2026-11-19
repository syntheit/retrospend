// Turning on Advanced protection, the web's side: the sheet's two callbacks
// (makeKeys, save) over this browser's ports. The flow (make the keys, check
// them before sending, send, read them back with the digest, word every
// failure) is @retrospend/crypto/client's, shared with the phone; this file
// only asks the server, signs in again when the session is too old, and keeps
// the "this address is keyed" record. It throws KeyFlowError and nothing else.
import type {
	EnableCallbacks,
	EnablePorts,
	KeyFlowCode,
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
	/** Email and password sign-in. `twoFactor` means a code is asked next. */
	signIn(email: string, password: string): Promise<RefreshStep>;
	verifyCode(code: string): Promise<RefreshStep>;
}
export type RefreshStep =
	| { status: "signedIn" | "twoFactor" }
	| { status: "error"; httpStatus: number | null };

type AuthResult = {
	data: unknown;
	error: { status?: number } | null;
};

function step(result: AuthResult): RefreshStep {
	if (result.error)
		return { status: "error", httpStatus: result.error.status ?? null };
	return (result.data as { twoFactorRedirect?: boolean } | null)
		?.twoFactorRedirect
		? { status: "twoFactor" }
		: { status: "signedIn" };
}

/** better-auth's own client, loaded when a session has to be renewed. */
async function authClientRefresh(): Promise<SessionRefresh> {
	const { authClient } = await import("~/lib/auth-client");
	const run = async (go: () => Promise<AuthResult>): Promise<RefreshStep> => {
		try {
			return step(await go());
		} catch {
			return { status: "error", httpStatus: null };
		}
	};
	return {
		signIn: (email, password) =>
			run(() => authClient.signIn.email({ email, password })),
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

/** Why a sign-in step failed, as the flow's code for it. */
function stepFailure(
	core: Core,
	failed: { httpStatus: number | null },
	refused: KeyFlowCode,
) {
	const { httpStatus } = failed;
	return new core.KeyFlowError(
		httpStatus === null
			? "unavailable"
			: httpStatus === 429
				? "rateLimited"
				: httpStatus === 401 || httpStatus === 400
					? refused
					: "failed",
	);
}

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
		signInAgain: async ({ password, code }) => {
			const session = deps.session ?? (await authClientRefresh());
			let secret: string;
			try {
				// No keys yet, so this is the typed password; a keyed answer would
				// give the key made from it.
				secret = await signInSecretFor(account.email, password, { deps });
			} catch (error) {
				throw new core.KeyFlowError(
					error instanceof SignInSecretError && error.code === "rateLimited"
						? "rateLimited"
						: "unavailable",
				);
			}
			let next = await session.signIn(
				account.email.trim().toLowerCase(),
				secret,
			);
			if (next.status === "twoFactor") {
				// The sheet asks for the code whenever it is on, so a missing one is a wrong one.
				if (!code) throw new core.KeyFlowError("wrongCode");
				next = await session.verifyCode(code);
				if (next.status === "error") throw stepFailure(core, next, "wrongCode");
			} else if (next.status === "error")
				throw stepFailure(core, next, "wrongPassword");
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
		built ??= loadCore().then((core) =>
			core.createEnableCallbacks(
				ports(core, deps, account),
				options.params ? { params: options.params } : undefined,
			),
		);
		return built;
	};
	return {
		makeKeys: (password) => callbacks().then((c) => c.makeKeys(password)),
		save: (draft, input) => callbacks().then((c) => c.save(draft, input)),
	};
}
