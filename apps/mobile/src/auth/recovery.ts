// Getting back in with the recovery key, the phone's side: asking for the code
// the reset email carries, swapping it for a recovery token, the link check,
// and the recovery callbacks' ports (begin, check, commit) over the typed API
// client. The flow (prove the key before a new password is asked for, make and
// check the new wraps, settle a lost commit by the link check, word every
// failure) is @retrospend/crypto/client's, shared with the web; the code's
// reading is @retrospend/crypto's `readResetCode`, the one the server uses.
// This file only asks the server and holds the reset token. It never logs or
// stores the code, the token, the recovery key or the new password.
import type { RetrospendClient } from "@retrospend/api-client";
import { readResetCode } from "@retrospend/crypto";
import {
	createRecoveryCallbacks,
	type KeyFlowCode,
	KeyFlowError,
	type RecoveryCallbacks,
	type RecoveryFlowPorts,
	type RecoveryLink,
	readRecoveryLink,
} from "@retrospend/crypto/client";
import { getPrimitives } from "@/crypto/native";
import { paintFrames } from "./paint";
import { callWithTimeout, type SecretDeps } from "./sign-in-secret";

/** The public auth routes the recovery needs: none of them takes a session. */
export type RecoveryApi = Pick<
	RetrospendClient["auth"],
	| "requestResetCode"
	| "redeemResetCode"
	| "checkRecovery"
	| "beginRecovery"
	| "recover"
>;

/** Why the code could not be asked for or swapped. `typo` is refused here, before a try is spent. */
export type CodeFailure =
	| "typo"
	| "wrongCode"
	| "tooMany"
	| "network"
	| "cannotSend"
	| "failed";

export type CodeResult<T> =
	| { ok: true; value: T }
	| { ok: false; reason: CodeFailure };

const failureOf = (error: unknown): KeyFlowCode =>
	error instanceof KeyFlowError ? error.code : "failed";

/** The failure a request for a code gets. The answer is alike for every address, so no reason says whether one exists. */
function requestFailure(code: KeyFlowCode): CodeFailure {
	switch (code) {
		case "rateLimited":
			return "tooMany";
		case "unavailable":
			return "network";
		// 409: the server cannot send email.
		case "conflict":
			return "cannotSend";
		default:
			return "failed";
	}
}

/** The failure swapping a code gets. A wrong, expired, used and unknown code are one answer (404). */
function redeemFailure(code: KeyFlowCode): CodeFailure {
	switch (code) {
		case "tokenExpired":
			return "wrongCode";
		case "rateLimited":
			return "tooMany";
		case "unavailable":
			return "network";
		default:
			return "failed";
	}
}

/** Asks the server to mail the reset code. It says success for every address, so success says nothing about the account. */
export async function requestResetCode(
	api: Pick<RecoveryApi, "requestResetCode">,
	email: string,
): Promise<CodeResult<null>> {
	try {
		await callWithTimeout((o) =>
			api.requestResetCode({ email: email.trim() }, o),
		);
		return { ok: true, value: null };
	} catch (error) {
		return { ok: false, reason: requestFailure(failureOf(error)) };
	}
}

/**
 * Swaps the typed code for a recovery token. Text that cannot be a code is
 * refused here (`typo`): the server counts a malformed code as a wrong try,
 * and only 5 an hour are allowed.
 */
export async function redeemResetCode(
	api: Pick<RecoveryApi, "redeemResetCode">,
	email: string,
	typed: string,
): Promise<CodeResult<string>> {
	const code = readResetCode(typed);
	if (code === null) return { ok: false, reason: "typo" };
	try {
		const answer = (await callWithTimeout((o) =>
			api.redeemResetCode({ email: email.trim(), code }, o),
		)) as { token?: unknown } | null;
		const token = answer?.token;
		if (typeof token !== "string" || token === "")
			return { ok: false, reason: "failed" };
		return { ok: true, value: token };
	} catch (error) {
		return { ok: false, reason: redeemFailure(failureOf(error)) };
	}
}

/**
 * What the token leads to. `invalid` is the server not knowing it (used,
 * expired). A question that could not be answered, or an answer of another
 * shape, throws KeyFlowError and is never read as "no keys".
 */
export async function checkRecoveryLink(
	api: Pick<RecoveryApi, "checkRecovery">,
	token: string,
): Promise<RecoveryLink | "invalid"> {
	try {
		return readRecoveryLink(
			await callWithTimeout((o) => api.checkRecovery({ token }, o)),
		);
	} catch (error) {
		if (failureOf(error) === "tokenExpired") return "invalid";
		throw error;
	}
}

export type PhoneRecoveryDeps = Pick<SecretDeps, "primitives"> & {
	paint?: () => Promise<void>;
};

function ports(
	api: RecoveryApi,
	token: string,
	deps: PhoneRecoveryDeps,
): RecoveryFlowPorts {
	return {
		primitives: deps.primitives,
		paint: deps.paint ?? paintFrames,
		begin: (body) =>
			callWithTimeout((o) => api.beginRecovery({ token, ...body }, o)),
		check: async () => {
			await callWithTimeout((o) => api.checkRecovery({ token }, o));
		},
		commit: async (body) => {
			await callWithTimeout((o) => api.recover({ token, ...body }, o));
		},
	};
}

/**
 * The recovery sheet's callbacks for one recovery token. One instance per
 * sheet: its handles are remembered here, so `finish` only takes a handle this
 * instance's `begin` made. `params` is for tests (cheaper Argon2id).
 */
export function phoneRecoveryCallbacks(
	api: RecoveryApi,
	token: string,
	deps: PhoneRecoveryDeps = { primitives: getPrimitives },
	params?: { memoryKiB: number; passes: number },
): RecoveryCallbacks {
	return createRecoveryCallbacks(
		ports(api, token, deps),
		params ? { params } : undefined,
	);
}
