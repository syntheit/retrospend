// The recovery page's two callbacks (begin and finish), built once for the web
// and the phone over the same ports, like enable-flow.ts does for enable. A
// platform says how to ask its server (it holds the reset token); this proves
// the recovery key, makes the new password's wraps, commits, and settles every
// doubt by asking the server. Nothing here touches the network or storage.
//
// What a retry sends. A commit that was refused (a rate limit, a bad request)
// surely did not commit, so the next `finish` makes its body again from the
// password as typed then. A commit whose outcome is not known keeps its body,
// and the screen holds the password still, so the retry is the same request.
//
// Why the commit is not simply sent again. The reset link works once, so a
// commit whose answer never came (`unavailable`, a 5xx) may have used it. The
// next `finish` asks the link check first: a link that is spent means the
// commit landed (the person signs in with the new password, which proves it);
// a link still live means nothing was stored and the same body goes out again.
// A refusal that says the keys changed (`conflict`) is never sent again: the
// draft is stale and the caller starts over from `begin`.
import type { Argon2Params } from "../primitives";
import {
	asKeyFlowError,
	KeyFlowError,
	mayHaveCommitted,
} from "./flow";
import { endsRecoveryHandle } from "./recovery-failure";
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
	/**
	 * The body of a commit whose outcome is not known (the sign-in secret in it
	 * is a password's equal): kept only then, so a retry sends the very thing
	 * that may have committed. Any other failure drops it, and a retry makes a
	 * new one from the password as typed now.
	 */
	unknownBody: RecoverBody | null;
	/** Commits sent so far. */
	sends: number;
	wiped: boolean;
};

export type RecoveryCallbacks = {
	/** The recovery key text in, a handle out once the server accepted its proof. */
	begin(recoveryKeyText: string): Promise<RecoveryHandle>;
	/**
	 * The new password in: wraps, commits and settles. Resolves `set` when the
	 * server took the new password, or `linkSpent` when a commit whose answer
	 * never came left the link used (it was this commit, or the link expired
	 * meanwhile, and the caller cannot tell which: the sign-in tells).
	 */
	finish(
		handle: RecoveryHandle,
		input: { password: string },
	): Promise<"set" | "linkSpent">;
};

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
			const held: Held = {
				draft,
				unknownBody: null,
				sends: 0,
				wiped: false,
			};
			const handle: RecoveryHandle = {
				wipe: () => {
					held.wiped = true;
					held.unknownBody = null;
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
				if (held.unknownBody) {
					// The last commit may have used the link: look before sending again.
					try {
						await ports.check();
					} catch (error) {
						if (asKeyFlowError(error).code === "tokenExpired") {
							handle.wipe();
							return "linkSpent";
						}
						throw error;
					}
				}
				// An unknown commit is sent again as it was. Anything else is made from
				// the password as typed now, so a retry after a refusal never sends an
				// older password under a "Password updated".
				const body =
					held.unknownBody ??
					(await finishRecovery(
						ports,
						held.draft,
						{ password: input.password },
						options,
					));
				const earlier = held.sends++;
				try {
					await ports.commit(body);
				} catch (error) {
					const code = asKeyFlowError(error).code;
					if (endsRecoveryHandle(code)) handle.wipe();
					if (!held.wiped && mayHaveCommitted(code, earlier)) {
						held.unknownBody = body;
						// Only the body is needed to send it again.
						held.draft.wipe();
						throw new KeyFlowError("unconfirmed");
					}
					throw error;
				}
				handle.wipe();
				return "set";
			} catch (error) {
				throw asKeyFlowError(error);
			}
		},
	};
}
