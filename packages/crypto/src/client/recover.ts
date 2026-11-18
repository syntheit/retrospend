// Setting a new password with the recovery key, on the client, when the old
// password is lost. The person's recovery key text is read, both of its
// subkeys are derived, the server answers the proof (begin) with the two wraps
// the key opens, the account key and the private key come out of them, and the
// account key is wrapped again under the new password. Everything that will be
// sent is opened again first (checkOpens): a wrap that could lock the person
// out never leaves. The commit and the sign-in after it belong to the adapter,
// which also holds the reset token. Every key made here is wiped before this
// returns or throws; what is left is text.
import { fromBase64Url, toBase64Url } from "../base64url";
import {
	deriveMasterKey,
	keyPairMatches,
	parseRecoveryKey,
	recoverySubkeys,
	unwrapKey,
	wrapKey,
} from "../keys";
import { type Argon2Params, SALT_BYTES, wipe } from "../primitives";
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
 * Throws KeyFlowError: `typo` for text that is not a recovery key (nothing is
 * sent), `wrongRecoveryKey` from the port when the server refuses the proof,
 * `malformed` when a wrap the proof unlocked does not open, is not for this
 * account, or does not match the public key (nothing is returned), and
 * `unavailable` for an answer of the wrong shape. Every key it makes is wiped
 * before it returns or throws.
 */
export async function recoverAccount(
	ports: RecoverPorts,
	input: RecoverInput,
	options: RecoverOptions = {},
): Promise<RecoverBody> {
	const params = allowedParams(options.params ?? NEW_PASSWORD_PARAMS);
	// Pure text work first: a typo never loads the library or asks the server.
	let parsed: Uint8Array;
	try {
		parsed = parseRecoveryKey(input.recoveryKeyText);
	} catch {
		throw new KeyFlowError("typo");
	}
	let p: Awaited<ReturnType<RecoverPorts["primitives"]>>;
	try {
		p = await ports.primitives();
	} catch (error) {
		wipe(parsed);
		throw asKeyFlowError(error);
	}
	const bin = secretBin(p);
	bin.keep(parsed);
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
		const accountKey = bin.keep(
			unwrapKey(p, recovery.wrapKey, "ak-recovery", begun.userId, recoveryWrap),
		);
		const privateKey = bin.keep(
			unwrapKey(p, accountKey, "private-key", begun.userId, privateKeyWrap),
		);
		// A private key of another set would unlock nothing the account holds.
		if (!keyPairMatches(p, { publicKey, privateKey }))
			throw new KeyFlowError("malformed");

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
			wrapKey(p, fresh.wrapKey, "ak-password", begun.userId, accountKey),
		);

		// What was made must open from the new password alone, as it will be
		// sent: the wrap, as text, opens under the new wrap key to the account key.
		checkOpens(p, bin, {
			wrappingKey: fresh.wrapKey,
			role: "ak-password",
			id: begun.userId,
			sent: wrappedAccountKey,
			expected: accountKey,
		});

		return {
			recoveryAuthKey,
			newAuthKey: signInSecret(fresh.authKey),
			kdf,
			wrappedAccountKey,
			baseVersion: begun.version,
		};
	} catch (error) {
		throw asKeyFlowError(error);
	} finally {
		bin.wipeAll();
	}
}
