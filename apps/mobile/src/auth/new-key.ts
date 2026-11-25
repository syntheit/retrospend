// Make new key, the phone's side: the sheet's two callbacks (makeKey, save)
// over the typed API client. The flow (make the key from the password, check
// it before sending, send, read the server's wrap digest back, never send
// again blind) is @retrospend/crypto/client's, shared with the web; this file
// only asks the server. It throws KeyFlowError and nothing else.
import type { RetrospendClient } from "@retrospend/api-client";
import {
	createNewKeyCallbacks,
	type NewKeyCallbacks,
	type NewKeyFlowPorts,
} from "@retrospend/crypto/client";
import { newClientId } from "@/data/ids";
import { paintFrames } from "./paint";
import { call, lookupPort, type SecretDeps } from "./sign-in-secret";

export type PhoneNewKeyInput = {
	api: Pick<
		RetrospendClient["protection"],
		"keys" | "openKeys" | "newRecoveryKey"
	>;
	/** The account id: the wraps are bound to it. */
	userId: string;
	/** A fresh Idempotency-Key for each send of a changed attempt. */
	newKey?: () => string;
};

export type PhoneNewKeyDeps = Pick<SecretDeps, "primitives"> & {
	paint?: () => Promise<void>;
};

function ports(
	input: PhoneNewKeyInput,
	deps: PhoneNewKeyDeps,
): NewKeyFlowPorts {
	return {
		primitives: deps.primitives,
		paint: deps.paint ?? paintFrames,
		lookup: lookupPort({ route: "keys", ask: () => input.api.keys() }),
		lookupRoute: "keys",
		userId: input.userId,
		open: (body) => call(() => input.api.openKeys(body)),
		commit: async (body, idempotencyKey) => {
			await call(() =>
				input.api.newRecoveryKey(body, { context: { idempotencyKey } }),
			);
		},
		newKey: input.newKey ?? newClientId,
	};
}

/**
 * The Make new key sheet's callbacks for the signed-in account. One instance
 * per sheet: its drafts are remembered here, so `save` only takes a draft this
 * instance's `makeKey` made.
 */
export function phoneNewKeyCallbacks(
	input: PhoneNewKeyInput,
	deps: PhoneNewKeyDeps,
): NewKeyCallbacks {
	return createNewKeyCallbacks(ports(input, deps));
}
