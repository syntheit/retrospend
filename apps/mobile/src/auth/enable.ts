// Turning on Advanced protection, the phone's side: the sheet's two callbacks
// (makeKeys, save) over this phone's ports. The flow (make the keys, check
// them before sending, send, read them back with the digest, word every
// failure) is @retrospend/crypto/client's, shared with the web; this file
// only calls the typed API client, signs in again when the session is too
// old, and keeps the keystore record. It throws KeyFlowError and nothing else.
import type { RetrospendClient } from "@retrospend/api-client";
import {
	createEnableCallbacks,
	type EnableCallbacks,
	type EnablePorts,
	KeyFlowError,
} from "@retrospend/crypto/client";
import { newClientId } from "@/data/ids";
import type { SignInStep } from "./auth-api";
import { call, keyedRecord, type SecretDeps } from "./sign-in-secret";

/** Sign-in as the session holds it: the password step, then the code when the account has two-factor. */
export interface SignInAgain {
	signIn(email: string, password: string): Promise<SignInStep>;
	verifyCode(code: string): Promise<SignInStep>;
}

export type PhoneEnableInput = {
	api: Pick<RetrospendClient["protection"], "enable" | "openKeys">;
	baseUrl: string;
	email: string;
	/** The account id: the wraps are bound to it. */
	userId: string;
	/** Read when it is needed, so a session that changed since the sheet opened is the one used. */
	session: () => SignInAgain;
	/** A fresh Idempotency-Key for each draft. */
	newKey?: () => string;
};

export type PhoneEnableDeps = Pick<SecretDeps, "primitives" | "store"> & {
	/** Lets the busy state paint before Argon2id blocks the JS thread. */
	paint?: () => Promise<void>;
};

/** Two frames, so "Making your keys" shows before the blocking work starts. */
const paintFrames = () =>
	new Promise<void>((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
	);

/** Why a sign-in step failed, as the flow's code for it. */
function stepFailure(step: Extract<SignInStep, { status: "error" }>) {
	switch (step.reason) {
		case "invalidCredentials":
			return new KeyFlowError("wrongPassword");
		case "invalidCode":
			return new KeyFlowError("wrongCode");
		case "rateLimited":
			return new KeyFlowError("rateLimited");
		case "network":
			return new KeyFlowError("unavailable");
		default:
			return new KeyFlowError("failed");
	}
}

function ports(input: PhoneEnableInput, deps: PhoneEnableDeps): EnablePorts {
	return {
		primitives: deps.primitives,
		paint: deps.paint ?? paintFrames,
		record: keyedRecord(input, deps),
		userId: input.userId,
		newKey: input.newKey ?? newClientId,
		enable: async (body, idempotencyKey) => {
			await call(() => input.api.enable(body, { context: { idempotencyKey } }));
		},
		open: (body) => call(() => input.api.openKeys(body)),
		signInAgain: async ({ password, code }) => {
			const session = input.session();
			let step = await session.signIn(input.email, password);
			if (step.status === "twoFactor") {
				// The sheet asks for the code whenever it is on, so a missing one is a wrong one.
				if (!code) throw new KeyFlowError("wrongCode");
				step = await session.verifyCode(code);
			}
			if (step.status === "error") throw stepFailure(step);
			if (step.status !== "signedIn") throw new KeyFlowError("failed");
		},
	};
}

/**
 * The enable sheet's callbacks for the signed-in account. One instance per
 * sheet: its drafts are remembered here, so `save` only takes a draft this
 * instance's `makeKeys` made. `params` is for tests (cheaper Argon2id).
 */
export function phoneEnableCallbacks(
	input: PhoneEnableInput,
	deps: PhoneEnableDeps,
	params?: { memoryKiB: number; passes: number },
): EnableCallbacks {
	return createEnableCallbacks(
		ports(input, deps),
		params ? { params } : undefined,
	);
}
