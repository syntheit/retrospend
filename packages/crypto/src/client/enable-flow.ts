// The enable sheet's two callbacks (makeKeys and save), built once for the web
// and the phone over the same ports. A platform supplies how to ask its server,
// where the "keyed" record lives and how to sign in again; this makes the keys,
// keeps each draft's secrets out of the sheet, sends them, reads them back and
// words every failure as an EnableFailure. Nothing here touches the network or
// storage.
import { type EnableBody, type PreparedEnable, prepareEnable } from "./enable";
import { EnableFailure, enableFailureFor } from "./enable-failure";
import type { KeyDraft } from "./enable-lifecycle";
import {
	asKeyFlowError,
	type FlowPorts,
	type KeyedRecord,
	KeyFlowError,
} from "./flow";

/** The enable route's body: the prepared body plus the person's proof. */
export type EnableRequest = EnableBody & {
	currentPassword: string;
	totpCode?: string;
};

export interface EnablePorts extends Pick<FlowPorts, "primitives" | "paint"> {
	/** The signed-in account's id: the wraps are bound to it. */
	userId: string;
	/**
	 * POST /me/protection/enable. A refusal throws KeyFlowError with the code
	 * `classifyRefusal` gives; no answer at all is `unavailable`. The same
	 * Idempotency-Key is sent again when the person retries this draft.
	 */
	enable(body: EnableRequest, idempotencyKey: string): Promise<void>;
	/** POST /me/protection/keys/open with the new sign-in secret; the answer comes back unread. */
	open(body: { authKey: string }): Promise<unknown>;
	/**
	 * Signs in again in place with what was typed (the account has no keys yet,
	 * so the typed password is what sign-in sends), for a session the server
	 * finds too old. Throws KeyFlowError (`wrongPassword`, `wrongCode`,
	 * `rateLimited`, `unavailable`).
	 */
	signInAgain(input: { password: string; code: string | null }): Promise<void>;
	/** The account is recorded as keyed as soon as the server has the keys. */
	record: KeyedRecord;
	/** A new Idempotency-Key for each draft. */
	newKey(): string;
}

type Held = {
	prepared: PreparedEnable;
	idempotencyKey: string;
	/** Its keys are gone: nothing may be sent with it. */
	wiped: boolean;
};

export type EnableCallbacks = {
	makeKeys(password: string): Promise<KeyDraft>;
	save(
		draft: KeyDraft,
		input: { password: string; code: string | null },
	): Promise<void>;
};

const failure = (error: unknown) =>
	new EnableFailure(enableFailureFor(asKeyFlowError(error).code));

/**
 * `options.params` is for tests: a cheaper Argon2id set than the real one.
 * Every draft's keys are reachable only through its own `wipe`; `save` never
 * wipes (the sheet does, when it closes), and a draft this did not make, or
 * one already wiped, is refused.
 */
export function createEnableCallbacks(
	ports: EnablePorts,
	options?: Parameters<typeof prepareEnable>[2],
): EnableCallbacks {
	const drafts = new WeakMap<KeyDraft, Held>();

	/** The enable call, once more after signing in again when the session was too old. */
	async function sendEnable(
		request: EnableRequest,
		idempotencyKey: string,
		input: { password: string; code: string | null },
	) {
		try {
			await ports.enable(request, idempotencyKey);
		} catch (error) {
			if (asKeyFlowError(error).code !== "sessionNotFresh") throw error;
			await ports.signInAgain(input);
			await ports.enable(request, idempotencyKey);
		}
	}

	return {
		async makeKeys(password) {
			let prepared: PreparedEnable;
			try {
				prepared = await prepareEnable(
					ports,
					{ userId: ports.userId, password },
					options,
				);
			} catch (error) {
				throw failure(error);
			}
			const held: Held = {
				prepared,
				idempotencyKey: ports.newKey(),
				wiped: false,
			};
			const draft: KeyDraft = {
				keyText: prepared.recoveryKeyText,
				wipe: () => {
					held.wiped = true;
					prepared.wipe();
				},
			};
			drafts.set(draft, held);
			return draft;
		},

		async save(draft, input) {
			const held = drafts.get(draft);
			// Not made here, or wiped: nothing is sent (a send could not be read back).
			if (!held || held.wiped) throw new EnableFailure("failed");
			const { prepared, idempotencyKey } = held;
			try {
				await sendEnable(
					{
						...prepared.body,
						currentPassword: input.password,
						...(input.code ? { totpCode: input.code } : {}),
					},
					idempotencyKey,
					input,
				);
			} catch (error) {
				throw failure(error);
			}
			// The server holds the keys now: remember it before anything else can
			// go wrong (the sign-in downgrade check). Only the record is lost if
			// this fails.
			await ports.record.set().catch(() => undefined);
			// From here a failure is final: saving again would meet "already keyed".
			try {
				prepared.readBack(await ports.open({ authKey: prepared.body.authKey }));
			} catch {
				throw failure(new KeyFlowError("readBackFailed"));
			}
		},
	};
}
