// The Make new key sheet's two callbacks (makeKey and save), built once for the
// web and the phone over the same ports, like enable-flow.ts does for enable. A
// platform says how to ask its server; this makes the key from the password,
// keeps each draft's secrets out of the sheet, sends the commit and reads it
// back. The old recovery key keeps working until the server commits the new
// one, so every doubt is settled by asking the server what it holds.
//
// What `save` may do again. A send whose answer never came (`unavailable`), that
// failed on the server (a 5xx) or reused its Idempotency-Key may have
// committed: the server is asked first. A stored wrap digest equal to the one
// sent is the success; anything else means nothing was stored and the same
// body goes out again under a new key. A conflict (the key set changed since it
// was read) is never sent again: the server is read, and a digest that is not
// ours is `conflict`, so the screen starts over. After every send that was
// answered, the digest is checked once more, so "saved" is only said for a key
// the server holds.
import { fromBase64Url } from "../base64url";
import { recoveryWrapDigest } from "../keys";
import type { KeyDraft } from "./enable-lifecycle";
import {
	asKeyFlowError,
	type KeyFlowCode,
	KeyFlowError,
	sameBytes,
} from "./flow";
import {
	type NewKeyCommitBody,
	type NewKeyPorts,
	prepareNewRecoveryKey,
} from "./new-key";

export interface NewKeyFlowPorts extends NewKeyPorts {
	/** The signed-in account's id: the wraps are bound to it. */
	userId: string;
	/**
	 * POST /me/protection/recovery-key. A refusal throws KeyFlowError with the
	 * code `classifyRefusal` gives; no answer at all is `unavailable`.
	 */
	commit(body: NewKeyCommitBody, idempotencyKey: string): Promise<void>;
	/** A new Idempotency-Key for each send of a changed attempt. */
	newKey(): string;
}

type Phase = "unsent" | "unknown" | "stored";

type Held = {
	/** The sign-in secret and the new key's proof: gone (null) once the draft is wiped, and nothing is sent after. */
	body: NewKeyCommitBody | null;
	idempotencyKey: string;
	phase: Phase;
};

export type NewKeyCallbacks = {
	/** Password in, a draft out: the new recovery key's text to show. */
	makeKey(password: string): Promise<KeyDraft>;
	/** Sends the draft and checks the server holds it. Never wipes the draft. */
	save(draft: KeyDraft): Promise<void>;
};

/** Codes where the server may have committed the send. */
const MAY_HAVE_COMMITTED: readonly KeyFlowCode[] = [
	"unavailable",
	"serverError",
	"keyReused",
];

export function createNewKeyCallbacks(ports: NewKeyFlowPorts): NewKeyCallbacks {
	const drafts = new WeakMap<KeyDraft, Held>();

	/**
	 * Whether the server holds the wrap this draft sent, by the digest keys/open
	 * answers. An answer that never came is thrown as it is (it can be asked
	 * again); any other refusal, or an answer of another shape, is a mismatch.
	 */
	async function stored(body: NewKeyCommitBody): Promise<boolean> {
		let answer: unknown;
		try {
			answer = await ports.open({ authKey: body.currentAuthKey });
		} catch (error) {
			const code = asKeyFlowError(error).code;
			if (
				code === "unavailable" ||
				code === "serverError" ||
				code === "rateLimited"
			)
				throw error;
			return false;
		}
		const digest = (answer as { recoveryWrapDigest?: unknown } | null)
			?.recoveryWrapDigest;
		const theirs = typeof digest === "string" ? fromBase64Url(digest) : null;
		const wrapped = fromBase64Url(body.wrappedRecoveryKey);
		if (!theirs || !wrapped) return false;
		const p = await ports.primitives();
		return sameBytes(theirs, recoveryWrapDigest(p, wrapped));
	}

	async function send(held: Held, body: NewKeyCommitBody): Promise<void> {
		try {
			await ports.commit(body, held.idempotencyKey);
		} catch (error) {
			const code = asKeyFlowError(error).code;
			if (MAY_HAVE_COMMITTED.includes(code)) {
				held.phase = "unknown";
				throw error;
			}
			if (code !== "conflict") throw error;
			// Not sent again: the server says whether it holds ours.
			if (await stored(body)) return;
			throw error;
		}
	}

	return {
		async makeKey(password) {
			const prepared = await prepareNewRecoveryKey(ports, {
				userId: ports.userId,
				password,
			});
			const held: Held = {
				body: prepared.body,
				idempotencyKey: ports.newKey(),
				phase: "unsent",
			};
			const draft: KeyDraft = {
				keyText: prepared.recoveryKeyText,
				wipe: () => {
					held.body = null;
				},
			};
			drafts.set(draft, held);
			return draft;
		},

		async save(draft) {
			const held = drafts.get(draft);
			const body = held?.body;
			// Not made here, or wiped: nothing is sent.
			if (!held || !body) throw new KeyFlowError("failed");
			try {
				if (held.phase === "unknown") {
					// The last send may have committed: look before sending anything.
					if (await stored(body)) held.phase = "stored";
					else {
						held.idempotencyKey = ports.newKey();
						held.phase = "unsent";
					}
				}
				if (held.phase === "unsent") {
					await send(held, body);
					held.phase = "stored";
				}
				// Saved is only said for a key the server holds.
				if (!(await stored(body))) throw new KeyFlowError("readBackFailed");
			} catch (error) {
				throw asKeyFlowError(error);
			}
		},
	};
}
