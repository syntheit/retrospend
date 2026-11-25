// Make new key, the web's side: the sheet's two callbacks (makeKey, save) over
// this browser's ports. The flow (make the key from the password, check it
// before sending, send, read the server's wrap digest back, never send again
// blind) is @retrospend/crypto/client's, shared with the phone; this file only
// asks the server. It throws KeyFlowError and nothing else.
import type {
	NewKeyCallbacks,
	NewKeyFlowPorts,
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
} from "./sign-in-secret";

export type WebNewKeyDeps = SignInSecretDeps & { newKey?: () => string };

function ports(
	core: Core,
	deps: WebNewKeyDeps,
	account: { id: string; email: string },
): NewKeyFlowPorts {
	const base = flowPorts(core, deps, account.email, true);
	const answer = async (path: string, body: unknown, key?: string) => {
		const wire = await post(core, deps, path, body, key);
		if (wire.status !== 200) throw refusal(core, wire);
		return wire.body;
	};
	return {
		primitives: base.primitives,
		paint: base.paint,
		lookup: base.lookup,
		lookupRoute: base.lookupRoute,
		userId: account.id,
		open: (body) => answer("/api/v1/me/protection/keys/open", body),
		commit: async (body, key) => {
			await answer("/api/v1/me/protection/recovery-key", body, key);
		},
		newKey: deps.newKey ?? generateId,
	};
}

/**
 * The Make new key sheet's callbacks for the signed-in account. One instance
 * per sheet: its drafts are remembered here, so `save` only takes a draft this
 * instance's `makeKey` made.
 */
export function webNewKeyCallbacks(
	account: { id: string; email: string },
	options: { deps?: Partial<WebNewKeyDeps> } = {},
): NewKeyCallbacks {
	const deps: WebNewKeyDeps = { ...defaults(), ...options.deps };
	let built: Promise<NewKeyCallbacks> | null = null;
	const callbacks = () => {
		built ??= loadCore()
			.then((core) => core.createNewKeyCallbacks(ports(core, deps, account)))
			.catch((error: unknown) => {
				// A script that failed to load is tried again, not remembered.
				built = null;
				throw error;
			});
		return built;
	};
	return {
		makeKey: (password) => callbacks().then((c) => c.makeKey(password)),
		save: (draft) => callbacks().then((c) => c.save(draft)),
	};
}
