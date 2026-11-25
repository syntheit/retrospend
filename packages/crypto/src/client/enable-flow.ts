// The enable sheet's two callbacks (makeKeys and save), built once for the web
// and the phone over the same ports. A platform supplies how to ask its server,
// where the "keyed" record lives and how to sign in again; this makes the keys,
// keeps each draft's secrets out of the sheet, sends them, reads them back and
// words every failure as an EnableFailure. Nothing here touches the network or
// storage.
//
// What `save` may do again. A send whose answer never came (`unavailable`), that failed on the
// server (a 5xx), or that was refused as a conflict or a reused key after an
// earlier send of the same draft, may
// have committed, so it is never sent again as it was: the keys are read back
// first. Keys that match are the success; no keys at all mean nothing was
// stored and a new send (a new Idempotency-Key) is allowed; anything else is
// final. A read-back that could not be made is not an answer: saving again
// makes it again and sends nothing.
import { type EnableBody, type PreparedEnable, prepareEnable } from "./enable";
import { EnableFailure, enableFailureFor } from "./enable-failure";
import type { KeyDraft } from "./enable-lifecycle";
import {
	asKeyFlowError,
	couldNotAsk,
	type FlowPorts,
	type KeyedRecord,
	type KeyFlowCode,
	KeyFlowError,
	mayHaveCommitted,
} from "./flow";

/** The enable route's body: the prepared body plus the person's proof. */
export type EnableRequest = EnableBody & {
	currentPassword: string;
	totpCode?: string;
};

/**
 * One step of signing in again, as a platform reports it. `rejected` is the
 * server saying no to what was typed (the core decides whether that is the
 * password or the code), `unreachable` is no answer at all.
 */
export type EnableSignInStep =
	| { status: "signedIn" | "twoFactor" }
	| {
			status: "error";
			kind: "rejected" | "rateLimited" | "unreachable" | "other";
	  };

export interface EnablePorts extends Pick<FlowPorts, "primitives" | "paint"> {
	/** The signed-in account's id: the wraps are bound to it. */
	userId: string;
	/**
	 * POST /me/protection/enable. A refusal throws KeyFlowError with the code
	 * `classifyRefusal` gives; no answer at all is `unavailable`.
	 */
	enable(body: EnableRequest, idempotencyKey: string): Promise<void>;
	/**
	 * POST /me/protection/keys/open with the new sign-in secret; the answer
	 * comes back unread. A refusal throws KeyFlowError with the code
	 * `classifyRefusal` gives (`notFound` for an account with no keys).
	 */
	open(body: { authKey: string }): Promise<unknown>;
	/**
	 * Signs in again in place for a session the server finds too old: the
	 * password step (the account has no keys yet, so the typed password is what
	 * sign-in sends) ...
	 */
	signIn(password: string): Promise<EnableSignInStep>;
	/** ... and the two-factor code step, when the first answered `twoFactor`. */
	verifyCode(code: string): Promise<EnableSignInStep>;
	/**
	 * Whether this device holds the "keyed" record: a device that knows the
	 * account has keys never sends its typed password (a throw reads as yes).
	 * `set` is called as soon as the server has the keys, and a throw is final.
	 */
	record: KeyedRecord;
	/** A new Idempotency-Key for each send. */
	newKey(): string;
}

/** Where a draft stands with the server. */
type Phase =
	/** Nothing is known to be stored: a send is allowed. */
	| "unsent"
	/** A send ended without a usable answer: the server may hold the keys. */
	| "unknown"
	/** The server answered the send: only the record and the read-back remain. */
	| "stored";

type Held = {
	prepared: PreparedEnable;
	idempotencyKey: string;
	phase: Phase;
	/** Sends made so far (a conflict only means "ours may be stored" after an earlier one). */
	sends: number;
	/** The keyed record was written. */
	recorded: boolean;
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

/** The code a sign-in step failure means at its stage: the same rule on every platform. */
function signInFailure(
	step: Extract<EnableSignInStep, { status: "error" }>,
	stage: "password" | "code",
): KeyFlowCode {
	switch (step.kind) {
		case "rejected":
			return stage === "password" ? "wrongPassword" : "wrongCode";
		case "rateLimited":
			return "rateLimited";
		case "unreachable":
			return "unavailable";
		case "other":
			return "failed";
	}
}

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

	async function signInAgain(input: { password: string; code: string | null }) {
		let step = await ports.signIn(input.password);
		let stage: "password" | "code" = "password";
		if (step.status === "twoFactor") {
			// The sheet asks for the code whenever it is on, so a missing one is a wrong one.
			if (!input.code) throw new KeyFlowError("wrongCode");
			stage = "code";
			step = await ports.verifyCode(input.code);
		}
		if (step.status === "error")
			throw new KeyFlowError(signInFailure(step, stage));
		if (step.status !== "signedIn") throw new KeyFlowError("failed");
	}

	/** The enable call, once more after signing in again when the session was too old (nothing was stored then). */
	async function sendEnable(
		request: EnableRequest,
		idempotencyKey: string,
		input: { password: string; code: string | null },
	) {
		try {
			await ports.enable(request, idempotencyKey);
		} catch (error) {
			if (asKeyFlowError(error).code !== "sessionNotFresh") throw error;
			await signInAgain(input);
			await ports.enable(request, idempotencyKey);
		}
	}

	/**
	 * The one send of a draft. A device that holds the keyed record, or whose
	 * record cannot be read, refuses first: the server may be lying that the
	 * account has no keys, and the typed password must not travel to it.
	 */
	async function send(
		held: Held,
		input: { password: string; code: string | null },
	) {
		let keyed: boolean;
		try {
			keyed = await ports.record.has();
		} catch {
			keyed = true;
		}
		if (keyed) throw new KeyFlowError("downgrade");
		// The sheet may have closed while the record was read: a wiped draft
		// sends nothing.
		if (held.wiped) throw new KeyFlowError("failed");
		const earlier = held.sends++;
		try {
			await sendEnable(
				{
					...held.prepared.body,
					currentPassword: input.password,
					...(input.code ? { totpCode: input.code } : {}),
				},
				held.idempotencyKey,
				input,
			);
		} catch (error) {
			const code = asKeyFlowError(error).code;
			// No answer, or a server failure (a gateway can answer 502 after the
			// commit), may have stored it. A conflict or a reused key means an
			// earlier send of this draft may have.
			if (mayHaveCommitted(code, earlier)) held.phase = "unknown";
			throw error;
		}
		held.phase = "stored";
	}

	/**
	 * Asks the server for the keys and compares them with the draft. `absent`
	 * is an account with no keys; a mismatch, or a refusal that is neither "no
	 * keys" nor "could not ask", is `readBackFailed`; an answer that never came
	 * (`unavailable`, `serverError`, `rateLimited`) is thrown as it is, so it can be asked again.
	 */
	async function readBack(held: Held): Promise<"match" | "absent"> {
		let answer: unknown;
		try {
			answer = await ports.open({ authKey: held.prepared.body.authKey });
		} catch (error) {
			const code = asKeyFlowError(error).code;
			if (code === "notFound") return "absent";
			if (couldNotAsk(code)) throw error;
			throw new KeyFlowError("readBackFailed");
		}
		try {
			held.prepared.readBack(answer);
		} catch {
			throw new KeyFlowError("readBackFailed");
		}
		return "match";
	}

	/** The server holds the keys: remember it on this device, then read them back. */
	async function finish(held: Held) {
		if (!held.recorded) {
			try {
				await ports.record.set();
			} catch {
				throw new KeyFlowError("unreadable");
			}
			held.recorded = true;
		}
		// Keys that are gone after the server accepted them are not ours.
		if ((await readBack(held)) === "absent")
			throw new KeyFlowError("readBackFailed");
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
				phase: "unsent",
				sends: 0,
				recorded: false,
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
			try {
				if (held.phase === "unknown") {
					// The last send may have committed: look before sending anything.
					if ((await readBack(held)) === "match") held.phase = "stored";
					else {
						held.idempotencyKey = ports.newKey();
						held.phase = "unsent";
					}
				}
				if (held.phase === "unsent") await send(held, input);
				await finish(held);
			} catch (error) {
				throw failure(error);
			}
		},
	};
}
