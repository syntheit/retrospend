// Making a new recovery key for an account that has keys, on the client. The
// account key comes out of the password wrap (the keys route the person proves
// the password to), a new recovery key is made, the account key is wrapped
// under it, and that wrap is opened again from the key's text before anything
// is returned. The old key keeps working until the server commits the new one.
// Every key made here is wiped before it returns or throws; what is left is
// text, and the key text for the person to write down.
import { fromBase64Url, toBase64Url } from "../base64url";
import {
	deriveMasterKey,
	encodeRecoveryKey,
	generateRecoveryKey,
	parseRecoveryKey,
	recoverySubkeys,
	unwrapKey,
	wrapKey,
} from "../keys";
import { KEY_BYTES, type Primitives } from "../primitives";
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
	lookupKdf,
	readKdf,
	readSalt,
	sameKdf,
	secretBin,
} from "./flow";

/** What the new recovery key route takes, less the current sign-in secret. */
export type NewKeyBody = {
	wrappedRecoveryKey: string;
	recoveryAuthKey: string;
	baseVersion: number;
};

export type PreparedNewKey = {
	body: NewKeyBody;
	/** The recovery key as the person writes it down: nine groups of six. */
	recoveryKeyText: string;
};

export type NewKeyInput = {
	/** The account id: the wrap is bound to it. */
	userId: string;
	/**
	 * The account key, opened from the password wrap. The caller owns it and
	 * wipes it; this function only reads it.
	 */
	accountKey: Uint8Array;
	/** The key set version the account key was read from. */
	baseVersion: number;
};

/**
 * One new recovery key for an account key in hand (the key holder's entry).
 * Throws KeyFlowError: `malformed` when what was made does not open from the
 * text the person will have.
 */
export function makeNewRecoveryKey(
	p: Primitives,
	input: NewKeyInput,
): PreparedNewKey {
	const bin = secretBin(p);
	try {
		if (
			!Number.isInteger(input.baseVersion) ||
			input.accountKey.length !== KEY_BYTES
		)
			throw new KeyFlowError("malformed");
		const recoveryKey = bin.keep(generateRecoveryKey(p));
		const recovery = recoverySubkeys(p, recoveryKey);
		bin.keep(recovery.wrapKey);
		bin.keep(recovery.authKey);
		const body: NewKeyBody = {
			wrappedRecoveryKey: toBase64Url(
				wrapKey(
					p,
					recovery.wrapKey,
					"ak-recovery",
					input.userId,
					input.accountKey,
				),
			),
			recoveryAuthKey: toBase64Url(recovery.authKey),
			baseVersion: input.baseVersion,
		};
		const recoveryKeyText = encodeRecoveryKey(recoveryKey);

		// As in enable: the wrap must open with the key read back from the text
		// the person writes down, and that key must make the proof sent.
		const written = recoverySubkeys(
			p,
			bin.keep(parseRecoveryKey(recoveryKeyText)),
		);
		bin.keep(written.wrapKey);
		bin.keep(written.authKey);
		if (body.recoveryAuthKey !== toBase64Url(written.authKey))
			throw new KeyFlowError("malformed");
		checkOpens(p, bin, {
			wrappingKey: written.wrapKey,
			role: "ak-recovery",
			id: input.userId,
			sent: body.wrappedRecoveryKey,
			expected: input.accountKey,
		});
		return { body, recoveryKeyText };
	} catch (error) {
		throw asKeyFlowError(error);
	} finally {
		bin.wipeAll();
	}
}

/** What the keys route answers: the version, the kdf the proof was made for and the wraps (ak-password is the one read). */
export type OpenAnswer = {
	version: number;
	kdf: Kdf;
	passwordWrap: string;
};

/** The keys route's answer from the port, unread until now. Another shape is "unavailable". */
export function readOpenAnswer(body: unknown): OpenAnswer {
	const { version, kdf, wraps } =
		typeof body === "object" && body !== null
			? (body as Record<string, unknown>)
			: ({} as Record<string, unknown>);
	const answerKdf = readKdf(kdf);
	if (!answerKdf || !Number.isInteger(version))
		throw new KeyFlowError("unavailable");
	return {
		version: version as number,
		kdf: answerKdf,
		passwordWrap: findWrap(wraps, "ak-password"),
	};
}

export interface NewKeyPorts
	extends Pick<FlowPorts, "primitives" | "paint" | "lookup" | "lookupRoute"> {
	/**
	 * Proves the current sign-in secret to the keys route and returns the
	 * answer unread (the core reads it with readOpenAnswer). A refusal throws
	 * KeyFlowError with the code `classifyRefusal` gives.
	 */
	open(body: { authKey: string }): Promise<unknown>;
}

export type NewKeyPasswordInput = {
	/** The account id: the wraps are bound to it. */
	userId: string;
	/** The current password, typed. */
	password: string;
};

/** What the new recovery key route takes: the current sign-in secret and the new key's parts. */
export type NewKeyCommitBody = NewKeyBody & { currentAuthKey: string };

export type PreparedNewKeyFromPassword = {
	body: NewKeyCommitBody;
	recoveryKeyText: string;
};

/**
 * Password in, new recovery key out: derives the sign-in secret from the
 * account's kdf (one Argon2id run), opens the keys route, opens the account
 * key from the password wrap and makes the key. Throws KeyFlowError.
 */
export async function prepareNewRecoveryKey(
	ports: NewKeyPorts,
	input: NewKeyPasswordInput,
): Promise<PreparedNewKeyFromPassword> {
	try {
		const keys = await lookupKdf(ports);
		if (!keys) throw new KeyFlowError("downgrade");
		// Everything the server sent is checked before the library loads.
		const params = allowedParams(keys);
		const salt = readSalt(keys.salt);
		const p = await ports.primitives();
		const bin = secretBin(p);
		try {
			await ports.paint?.();
			const mine = binMasterSubkeys(
				p,
				bin,
				deriveMasterKey(p, input.password, salt, params),
			);
			const currentAuthKey = signInSecret(mine.authKey);
			const opened = readOpenAnswer(
				await ports.open({ authKey: currentAuthKey }),
			);
			// The proof was made for the salt and parameters the first lookup gave:
			// an answer with others is a key set that changed in between.
			if (!sameKdf(opened.kdf, keys)) throw new KeyFlowError("conflict");
			const wrap = fromBase64Url(opened.passwordWrap);
			if (!wrap) throw new KeyFlowError("malformed");
			const accountKey = bin.keep(
				unwrapKey(p, mine.wrapKey, "ak-password", input.userId, wrap),
			);
			const made = makeNewRecoveryKey(p, {
				userId: input.userId,
				accountKey,
				baseVersion: opened.version,
			});
			return {
				body: { currentAuthKey, ...made.body },
				recoveryKeyText: made.recoveryKeyText,
			};
		} finally {
			bin.wipeAll();
		}
	} catch (error) {
		throw asKeyFlowError(error);
	}
}
