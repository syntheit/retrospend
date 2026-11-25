// Setting a new password with the recovery key, on the client, when the old
// password is lost. Two steps, so a wrong key is found before a new password
// is asked for: beginRecovery reads the recovery key text, derives both of its
// subkeys, sends the proof and opens the two wraps the server answers with
// (the account key, the private key, which must match the public key);
// finishRecovery wraps the account key again under the new password. Everything
// that will be sent is opened again first (checkOpens): a wrap that could lock
// the person out never leaves. The commit and the sign-in after it belong to
// the adapter, which also holds the reset token. Every key made here is wiped
// before it returns or throws, except the account key inside the draft between
// the two steps, which the caller wipes; what is left is text.
import { fromBase64Url, toBase64Url } from "../base64url";
import {
	deriveMasterKey,
	keyPairMatches,
	parseRecoveryKey,
	recoverySubkeys,
	unwrapKey,
	wrapKey,
} from "../keys";
import {
	type Argon2Params,
	type Primitives,
	SALT_BYTES,
	wipe,
} from "../primitives";
import { signInSecret } from "../sign-in-secret";
import {
	allowedParams,
	asKeyFlowError,
	binMasterSubkeys,
	checkOpens,
	type FlowPorts,
	findWrap,
	type Kdf,
	KeyFlowError,
	NEW_PASSWORD_PARAMS,
	secretBin,
} from "./flow";

/** What the begin route answers once the proof passed: who, which version of the key set, the public key and the wraps the key opens. */
export type RecoverBeginAnswer = {
	userId: string;
	version: number;
	/** base64url */
	publicKey: string;
	/** The ak-recovery and private-key wraps, base64url. */
	recoveryWrap: string;
	privateKeyWrap: string;
};

/**
 * The begin route's answer from the port, which hands it over unread. One
 * that is not exactly this shape is "unavailable": nothing is derived from it
 * and no commit body is made.
 */
export function readRecoverBeginAnswer(body: unknown): RecoverBeginAnswer {
	const { userId, version, publicKey, wraps } =
		typeof body === "object" && body !== null
			? (body as Record<string, unknown>)
			: ({} as Record<string, unknown>);
	if (
		typeof userId !== "string" ||
		userId === "" ||
		typeof publicKey !== "string" ||
		!Number.isInteger(version)
	)
		throw new KeyFlowError("unavailable");
	return {
		userId,
		version: version as number,
		publicKey,
		recoveryWrap: findWrap(wraps, "ak-recovery"),
		privateKeyWrap: findWrap(wraps, "private-key"),
	};
}

/** What a reset link leads to (the check route's answer). */
export type RecoveryLink = {
	keys: "none" | "recovery" | "noRecovery";
	protectionOn: boolean;
};

/**
 * The check route's answer from the port, unread until now. One that is not
 * exactly this shape is "unavailable": a screen never reads it as "no keys"
 * and shows the plain reset on a guess.
 */
export function readRecoveryLink(body: unknown): RecoveryLink {
	const { keys, protectionOn } = (
		typeof body === "object" && body !== null ? body : {}
	) as Record<string, unknown>;
	if (
		(keys !== "none" && keys !== "recovery" && keys !== "noRecovery") ||
		typeof protectionOn !== "boolean"
	)
		throw new KeyFlowError("unavailable");
	return { keys, protectionOn };
}

/** The commit route's body (the reset token goes beside it, held by the adapter). */
export type RecoverBody = {
	recoveryAuthKey: string;
	newAuthKey: string;
	kdf: Kdf;
	wrappedAccountKey: string;
	baseVersion: number;
};

export interface RecoverPorts extends Pick<FlowPorts, "primitives" | "paint"> {
	/**
	 * Sends the recovery proof (with the reset token the adapter holds) and
	 * returns the answer unread; the core reads it with readRecoverBeginAnswer.
	 * A refusal throws KeyFlowError with the code `classifyRefusal` gives.
	 */
	begin(body: { recoveryAuthKey: string }): Promise<unknown>;
}

export type RecoverInput = {
	/** The recovery key as typed or pasted: nine groups of six, in any case, with or without hyphens. */
	recoveryKeyText: string;
	/** The new password, typed. */
	password: string;
};

export type RecoverOptions = {
	/** Tests only: a cheaper parameter set than NEW_PASSWORD_PARAMS. It still has to pass the floor and ceiling. */
	params?: Argon2Params;
};

/**
 * The account key the recovery key opened, held between the two steps of the
 * flow (the key was proven, the new password is not typed yet). The handle
 * shows nothing: the key is reachable only by `finishRecovery`, and `wipe`
 * zeroes it. The caller wipes the handle when the flow ends, goes back or
 * closes, and a wiped handle finishes nothing.
 */
export type RecoveryDraft = { readonly wipe: () => void };

type Held = {
	p: Primitives;
	userId: string;
	version: number;
	recoveryAuthKey: string;
	accountKey: Uint8Array;
	wiped: boolean;
};
const drafts = new WeakMap<RecoveryDraft, Held>();

/**
 * Step one: reads the recovery key text, sends the proof (begin) and opens the
 * two wraps it unlocks, so a wrong key, a key of another account or a corrupt
 * answer stops here, before a new password is asked for. Throws KeyFlowError:
 * `typo` for text that is not a recovery key (nothing is sent),
 * `wrongRecoveryKey` from the port when the server refuses the proof,
 * `malformed` when a wrap the proof unlocked does not open, is not for this
 * account, or does not match the public key, and `unavailable` for an answer
 * of the wrong shape. Every key made here is wiped before it throws; on
 * success only the account key remains, inside the draft.
 */
export async function beginRecovery(
	ports: RecoverPorts,
	input: { recoveryKeyText: string },
): Promise<RecoveryDraft> {
	// Pure text work first: a typo never loads the library or asks the server.
	let parsed: Uint8Array;
	try {
		parsed = parseRecoveryKey(input.recoveryKeyText);
	} catch {
		throw new KeyFlowError("typo");
	}
	let p: Primitives;
	try {
		p = await ports.primitives();
	} catch (error) {
		wipe(parsed);
		throw asKeyFlowError(error);
	}
	const bin = secretBin(p);
	bin.keep(parsed);
	// Kept out of the bin: it lives on in the draft until the caller wipes it.
	let accountKey: Uint8Array | null = null;
	try {
		const recovery = recoverySubkeys(p, parsed);
		bin.keep(recovery.wrapKey);
		bin.keep(recovery.authKey);
		const recoveryAuthKey = toBase64Url(recovery.authKey);

		const begun = readRecoverBeginAnswer(
			await ports.begin({ recoveryAuthKey }),
		);
		const recoveryWrap = fromBase64Url(begun.recoveryWrap);
		const privateKeyWrap = fromBase64Url(begun.privateKeyWrap);
		const publicKey = fromBase64Url(begun.publicKey);
		if (!recoveryWrap || !privateKeyWrap || !publicKey)
			throw new KeyFlowError("malformed");

		// The proof passed, so a wrap that does not open (unwrapKey throws, and
		// the run ends as `malformed`) is corrupt, swapped or bound to another
		// account: nothing is sent.
		accountKey = unwrapKey(
			p,
			recovery.wrapKey,
			"ak-recovery",
			begun.userId,
			recoveryWrap,
		);
		const privateKey = bin.keep(
			unwrapKey(p, accountKey, "private-key", begun.userId, privateKeyWrap),
		);
		// A private key of another set would unlock nothing the account holds.
		if (!keyPairMatches(p, { publicKey, privateKey }))
			throw new KeyFlowError("malformed");

		const held: Held = {
			p,
			userId: begun.userId,
			version: begun.version,
			recoveryAuthKey,
			accountKey,
			wiped: false,
		};
		const draft: RecoveryDraft = {
			wipe: () => {
				if (held.wiped) return;
				held.wiped = true;
				p.wipe(held.accountKey);
			},
		};
		drafts.set(draft, held);
		accountKey = null;
		return draft;
	} catch (error) {
		if (accountKey) p.wipe(accountKey);
		throw asKeyFlowError(error);
	} finally {
		bin.wipeAll();
	}
}

/**
 * Step two: the new password, wrapped around the account key the draft holds,
 * checked to open as it will be sent. Returns the commit body; the draft is
 * the caller's to wipe (a retry with another password may still need it).
 * Throws KeyFlowError: `params` for parameters outside the floor and ceiling,
 * `malformed` for a wiped or foreign draft or a wrap that would not open.
 */
export async function finishRecovery(
	ports: Pick<RecoverPorts, "paint">,
	draft: RecoveryDraft,
	input: { password: string },
	options: RecoverOptions = {},
): Promise<RecoverBody> {
	try {
		const params = allowedParams(options.params ?? NEW_PASSWORD_PARAMS);
		const held = drafts.get(draft);
		// Not made here, or wiped: there is no key to wrap.
		if (!held || held.wiped) throw new KeyFlowError("malformed");
		const { p } = held;
		const bin = secretBin(p);
		try {
			await ports.paint?.();
			const salt = bin.keep(p.randomBytes(SALT_BYTES));
			const fresh = binMasterSubkeys(
				p,
				bin,
				deriveMasterKey(p, input.password, salt, params),
			);
			const kdf: Kdf = {
				salt: toBase64Url(salt),
				memoryKiB: params.memoryKiB,
				passes: params.passes,
			};
			const wrappedAccountKey = toBase64Url(
				wrapKey(p, fresh.wrapKey, "ak-password", held.userId, held.accountKey),
			);

			// What was made must open from the new password alone, as it will be
			// sent: the wrap, as text, opens under the new wrap key to the account key.
			checkOpens(p, bin, {
				wrappingKey: fresh.wrapKey,
				role: "ak-password",
				id: held.userId,
				sent: wrappedAccountKey,
				expected: held.accountKey,
			});

			return {
				recoveryAuthKey: held.recoveryAuthKey,
				newAuthKey: signInSecret(fresh.authKey),
				kdf,
				wrappedAccountKey,
				baseVersion: held.version,
			};
		} finally {
			bin.wipeAll();
		}
	} catch (error) {
		throw asKeyFlowError(error);
	}
}

/**
 * Both steps in one call, for a caller that has the new password with the key
 * (the same flow, one run). Every key it makes is wiped before it returns or
 * throws; what is left is text. The parameters are checked before anything
 * else, so a bad set never loads the library or asks the server.
 */
export async function recoverAccount(
	ports: RecoverPorts,
	input: RecoverInput,
	options: RecoverOptions = {},
): Promise<RecoverBody> {
	try {
		allowedParams(options.params ?? NEW_PASSWORD_PARAMS);
		const draft = await beginRecovery(ports, input);
		try {
			return await finishRecovery(ports, draft, input, options);
		} finally {
			draft.wipe();
		}
	} catch (error) {
		throw asKeyFlowError(error);
	}
}
