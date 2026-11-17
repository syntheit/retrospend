// Changing the password of an account with keys, on the client: prove the old
// password, open the account key with it, wrap the same key under the new
// password, check that before sending, then commit. The server only ever sees
// the two sign-in secrets and the rewrapped account key.
import { fromBase64Url, toBase64Url } from "../base64url";
import { deriveMasterKey, masterSubkeys, unwrapKey, wrapKey } from "../keys";
import { type Argon2Params, SALT_BYTES } from "../primitives";
import { signInSecret } from "../sign-in-secret";
import {
	allowedParams,
	asKeyFlowError,
	type FlowPorts,
	type Kdf,
	KeyFlowError,
	lookupKdf,
	NEW_PASSWORD_PARAMS,
	readKdf,
	readSalt,
	sameKdf,
	secretBin,
} from "./flow";

/** What the begin route answers: the version, the kdf the proof was made for and the wrapped account key. */
export type BeginAnswer = {
	version: number;
	kdf: Kdf;
	wrappedAccountKey: string;
};

/**
 * The begin route's answer from the port, which hands it over unread. One
 * that is not exactly this shape is "unavailable": nothing is derived from it
 * and no commit is sent.
 */
export function readBeginAnswer(body: unknown): BeginAnswer {
	const { version, kdf, wrappedAccountKey } =
		typeof body === "object" && body !== null
			? (body as Record<string, unknown>)
			: ({} as Record<string, unknown>);
	const answerKdf = readKdf(kdf);
	if (
		!answerKdf ||
		typeof wrappedAccountKey !== "string" ||
		!Number.isInteger(version)
	)
		throw new KeyFlowError("unavailable");
	return { version: version as number, kdf: answerKdf, wrappedAccountKey };
}

/** The commit route's body. */
export type CommitBody = {
	currentAuthKey: string;
	newAuthKey: string;
	kdf: Kdf;
	wrappedAccountKey: string;
	baseVersion: number;
};

export interface RotatePorts extends FlowPorts {
	/**
	 * Proves the current sign-in secret and returns the answer unread (the core
	 * reads it with readBeginAnswer). A refusal throws KeyFlowError with the
	 * code `classifyRefusal` gives for its status.
	 */
	begin(body: { currentAuthKey: string }): Promise<unknown>;
	/** Commits; a refusal throws a KeyFlowError the same way. */
	commit(body: CommitBody, idempotencyKey: string): Promise<void>;
	/** A fresh Idempotency-Key for each commit. */
	newKey(): string;
}

export type RotateInput = {
	/** The account id: the wrap is bound to it. */
	userId: string;
	current: string;
	next: string;
};

export type RotateOptions = {
	/** Tests only: a cheaper parameter set than NEW_PASSWORD_PARAMS. It still has to pass the floor and ceiling. */
	newParams?: Argon2Params;
};

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => {
	let diff = a.length ^ b.length;
	for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	return diff === 0;
};

/** One run of the whole flow. Every key it makes is wiped before it returns or throws. */
async function rotateOnce(
	ports: RotatePorts,
	input: RotateInput,
	newParams: Argon2Params,
): Promise<void> {
	const keys = await lookupKdf(ports);
	if (!keys) throw new KeyFlowError("downgrade");
	// Everything the server sent is checked before the library loads.
	const oldParams = allowedParams(keys);
	allowedParams(newParams);
	const oldSalt = readSalt(keys.salt);
	const p = await ports.primitives();
	const bin = secretBin(p);
	const subkeys = (master: Uint8Array) => {
		const k = masterSubkeys(p, bin.keep(master));
		return { authKey: bin.keep(k.authKey), wrapKey: bin.keep(k.wrapKey) };
	};
	try {
		await ports.paint?.();
		const old = subkeys(deriveMasterKey(p, input.current, oldSalt, oldParams));
		const currentAuthKey = signInSecret(old.authKey);
		const begun = readBeginAnswer(await ports.begin({ currentAuthKey }));
		// The proof was made for the salt and parameters the keys route gave: an
		// answer with others is a key set that changed in between, and a second
		// run starts from the new one. (A hostile server gets nothing by it: no
		// commit is sent from this run.)
		if (!sameKdf(begun.kdf, keys)) throw new KeyFlowError("conflict");
		const oldWrap = fromBase64Url(begun.wrappedAccountKey);
		if (!oldWrap) throw new KeyFlowError("malformed");
		// The server proved the password was right, so a wrap that does not open
		// (unwrapKey throws, and the run ends as `malformed`) is corrupt or
		// swapped: nothing is sent.
		const accountKey = bin.keep(
			unwrapKey(p, old.wrapKey, "ak-password", input.userId, oldWrap),
		);

		const newSalt = bin.keep(p.randomBytes(SALT_BYTES));
		const fresh = subkeys(deriveMasterKey(p, input.next, newSalt, newParams));
		const newKdf: Kdf = {
			salt: toBase64Url(newSalt),
			memoryKiB: newParams.memoryKiB,
			passes: newParams.passes,
		};
		const newAuthKey = signInSecret(fresh.authKey);
		const wrappedAccountKey = toBase64Url(
			wrapKey(p, fresh.wrapKey, "ak-password", input.userId, accountKey),
		);

		// What was made must open from the new password alone, from the values
		// as they will be sent, or the person would lock themselves out.
		const sentSalt = fromBase64Url(newKdf.salt);
		const sentWrap = fromBase64Url(wrappedAccountKey);
		if (!sentSalt || !sentWrap) throw new KeyFlowError("malformed");
		const again = subkeys(deriveMasterKey(p, input.next, sentSalt, newParams));
		const reopened = bin.keep(
			unwrapKey(p, again.wrapKey, "ak-password", input.userId, sentWrap),
		);
		if (
			!sameBytes(reopened, accountKey) ||
			signInSecret(again.authKey) !== newAuthKey
		)
			throw new KeyFlowError("malformed");

		await ports.commit(
			{
				currentAuthKey,
				newAuthKey,
				kdf: newKdf,
				wrappedAccountKey,
				baseVersion: begun.version,
			},
			ports.newKey(),
		);
	} finally {
		bin.wipeAll();
	}
}

/**
 * Changes the password of an account with keys. A `conflict` (the keys
 * changed under the run) starts the whole run again once, with a new
 * Idempotency-Key; a second one is the answer. Any other failure is final.
 * Throws KeyFlowError. After a finished change the account is recorded as
 * keyed (best effort: the change is done whatever the record says).
 */
export async function rotatePassword(
	ports: RotatePorts,
	input: RotateInput,
	options: RotateOptions = {},
): Promise<void> {
	const newParams = options.newParams ?? NEW_PASSWORD_PARAMS;
	try {
		for (let attempt = 0; ; attempt++) {
			try {
				await rotateOnce(ports, input, newParams);
				break;
			} catch (error) {
				const again =
					error instanceof KeyFlowError &&
					error.code === "conflict" &&
					attempt === 0;
				if (!again) throw error;
			}
		}
	} catch (error) {
		throw asKeyFlowError(error);
	}
	try {
		await ports.record.set();
	} catch {
		// The change is done; a failed write of the record must not say otherwise.
	}
}
