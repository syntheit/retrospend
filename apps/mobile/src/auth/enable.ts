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
	type EnableSignInStep,
} from "@retrospend/crypto/client";
import { newClientId } from "@/data/ids";
import type { SignInStep } from "./auth-api";
import { paintFrames } from "./paint";
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

/** The session's sign-in answer as a step: invalid credentials and an invalid code are the server saying no to what was typed. */
export function signInStepOf(step: SignInStep): EnableSignInStep {
	if (step.status !== "error") return step;
	switch (step.reason) {
		case "invalidCredentials":
		case "invalidCode":
			return { status: "error", kind: "rejected" };
		case "rateLimited":
			return { status: "error", kind: "rateLimited" };
		case "network":
			return { status: "error", kind: "unreachable" };
		default:
			return { status: "error", kind: "other" };
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
		signIn: async (password) =>
			signInStepOf(await input.session().signIn(input.email, password)),
		verifyCode: async (code) =>
			signInStepOf(await input.session().verifyCode(code)),
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
