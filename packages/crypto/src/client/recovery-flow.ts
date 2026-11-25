// The recovery page's two callbacks (begin and finish), built once for the web
// and the phone over the same ports, like enable-flow.ts does for enable. A
// platform says how to ask its server (it holds the reset token); this proves
// the recovery key, makes the new password's wraps, commits, and settles every
// doubt by asking the server. Nothing here touches the network or storage.
//
// Why the commit is not simply sent again. The reset link works once, so a
// commit whose answer never came (`unavailable`, a 5xx) may have used it. The
// next `finish` asks the link check first: a link that is spent means the
// commit landed (the person signs in with the new password, which proves it);
// a link still live means nothing was stored and the same body goes out again.
// A refusal that says the keys changed (`conflict`) is never sent again: the
// draft is stale and the caller starts over from `begin`.
import type { Argon2Params } from "../primitives";
import { asKeyFlowError, type KeyFlowCode, KeyFlowError } from "./flow";
import {
	beginRecovery,
	finishRecovery,
	type RecoverBody,
	type RecoverPorts,
	type RecoveryDraft,
} from "./recover";

export interface RecoveryFlowPorts extends RecoverPorts {
	/**
	 * Asks whether the reset link is still live (the check route). A spent,
	 * unknown or expired link throws KeyFlowError("tokenExpired"); an answer that
	 * did not come throws `unavailable`.
	 */
	check(): Promise<void>;
	/**
	 * Sends the commit with the reset token the adapter holds. A refusal throws
	 * KeyFlowError with the code `classifyRefusal` gives; no answer at all is
	 * `unavailable`.
	 */
	commit(body: RecoverBody): Promise<void>;
}

/** What a begin leaves in the sheet: nothing to read, one way to wipe. */
export type RecoveryHandle = { readonly wipe: () => void };

type Held = {
	draft: RecoveryDraft;
	/** The body once a password was wrapped (the sign-in secret in it is a password's equal): gone on wipe. */
	body: RecoverBody | null;
	/** A commit was sent and its outcome is not known. */
	unknown: boolean;
	wiped: boolean;
};

export type RecoveryCallbacks = {
	/** The recovery key text in, a handle out once the server accepted its proof. */
	begin(recoveryKeyText: string): Promise<RecoveryHandle>;
	/** The new password in: wraps, commits and settles. Resolves when the new password is set. */
	finish(handle: RecoveryHandle, input: { password: string }): Promise<void>;
};

const MAY_HAVE_COMMITTED: readonly KeyFlowCode[] = [
	"unavailable",
	"serverError",
];
/** Refusals that make a handle useless: its proof or its version is no longer good, so it is wiped and never sent again. */
const ENDS_HANDLE: readonly KeyFlowCode[] = [
	"conflict",
	"tokenExpired",
	"wrongRecoveryKey",
	"recoveryUnavailable",
	"notFound",
];

export function createRecoveryCallbacks(
	ports: RecoveryFlowPorts,
	options?: { params?: Argon2Params },
): RecoveryCallbacks {
	const handles = new WeakMap<RecoveryHandle, Held>();

	return {
		async begin(recoveryKeyText) {
			const draft = await beginRecovery(ports, { recoveryKeyText }).catch(
				(error: unknown) => {
					throw asKeyFlowError(error);
				},
			);
			const held: Held = { draft, body: null, unknown: false, wiped: false };
			const handle: RecoveryHandle = {
				wipe: () => {
					held.wiped = true;
					held.body = null;
					draft.wipe();
				},
			};
			handles.set(handle, held);
			return handle;
		},

		async finish(handle, input) {
			const held = handles.get(handle);
			// Not made here, or wiped: nothing is sent.
			if (!held || held.wiped) throw new KeyFlowError("failed");
			try {
				if (held.unknown) {
					// The last commit may have used the link: look before sending again.
					try {
						await ports.check();
					} catch (error) {
						if (asKeyFlowError(error).code === "tokenExpired") {
							// Spent by our commit: the sign-in with the new password proves it.
							handle.wipe();
							return;
						}
						throw error;
					}
					held.unknown = false;
				}
				held.body ??= await finishRecovery(
					ports,
					held.draft,
					{ password: input.password },
					options,
				);
				// The account key has done its work: only text goes on from here.
				held.draft.wipe();
				try {
					await ports.commit(held.body);
				} catch (error) {
					const code = asKeyFlowError(error).code;
					if (MAY_HAVE_COMMITTED.includes(code)) held.unknown = true;
					if (ENDS_HANDLE.includes(code)) handle.wipe();
					throw error;
				}
			} catch (error) {
				throw asKeyFlowError(error);
			}
		},
	};
}
