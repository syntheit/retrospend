// Turning on Advanced protection, on the client: from a new password to every
// key and wrap the enable route takes. One Argon2id run, then the account key,
// the account key pair, a collection key and the recovery key are made, each
// wrapped for what opens it, and everything that will be sent is opened again
// before it leaves (checkOpens): a wrap that could lock the person out never
// reaches the server. The new password and every key but two are wiped before
// this returns; what is left is text, and the account key and the private key,
// which the read-back after saving needs (readBack) and the caller wipes
// when the flow ends (wipe).
import { fromBase64Url, toBase64Url } from "../base64url";
import { toHex } from "../hex";
import {
	deriveMasterKey,
	generateAccountKey,
	generateCollectionKey,
	keyPairMatches,
	type SymmetricRole,
	wrapKey,
} from "../keys";
import { type Argon2Params, KEY_BYTES, SALT_BYTES } from "../primitives";
import { signInSecret } from "../sign-in-secret";
import {
	allowedParams,
	asKeyFlowError,
	binMasterSubkeys,
	checkOpens,
	type FlowPorts,
	type Kdf,
	KeyFlowError,
	NEW_PASSWORD_PARAMS,
	secretBin,
} from "./flow";
import { checkStoredKeys } from "./enable-readback";
import { makeRecoveryKey } from "./recovery-key";

export type EnableWrap = {
	role: SymmetricRole;
	/** Your user id, or for a collection key the hex of its key id. */
	targetId: string;
	/** base64url */
	wrapped: string;
};

/** What the enable route takes, less the current password and two-factor code, which the caller adds. */
export type EnableBody = {
	authKey: string;
	recoveryAuthKey: string;
	kdf: Kdf;
	publicKey: string;
	wraps: EnableWrap[];
};

export type PreparedEnable = {
	body: EnableBody;
	/** The recovery key as the person writes it down: nine groups of six. */
	recoveryKeyText: string;
	/**
	 * Checks what the keys route answered after the keys were saved (the
	 * answer, unread) against what was sent and the keys held here. Throws
	 * KeyFlowError("readBackFailed") on any difference.
	 */
	readBack(answer: unknown): void;
	/** Wipes the account key and the private key this holds. Safe to call again; nothing reads back after it. */
	wipe(): void;
};

export type EnableInput = {
	/** The account id: the wraps are bound to it. */
	userId: string;
	/** The new password, typed. */
	password: string;
};

export type EnableOptions = {
	/** Tests only: a cheaper parameter set than NEW_PASSWORD_PARAMS. It still has to pass the floor and ceiling. */
	params?: Argon2Params;
};

const text = (bytes: Uint8Array) => toBase64Url(bytes);

/**
 * Throws KeyFlowError. Every key it makes is wiped before it throws, and
 * before it returns except the account key and the private key, which the
 * returned `wipe` clears.
 */
export async function prepareEnable(
	ports: Pick<FlowPorts, "primitives" | "paint">,
	input: EnableInput,
	options: EnableOptions = {},
): Promise<PreparedEnable> {
	const params = allowedParams(options.params ?? NEW_PASSWORD_PARAMS);
	const p = await ports.primitives();
	const bin = secretBin(p);
	// What the read-back needs: wiped by the caller on success, by us on a throw.
	const held = secretBin(p);
	try {
		await ports.paint?.();
		const salt = bin.keep(p.randomBytes(SALT_BYTES));
		const mine = binMasterSubkeys(
			p,
			bin,
			deriveMasterKey(p, input.password, salt, params),
		);
		const accountKey = held.keep(generateAccountKey(p));
		// The recovery key, its wrap and its text, checked as they are made.
		const recovery = makeRecoveryKey(p, bin, {
			userId: input.userId,
			accountKey,
		});
		const pair = p.boxKeypair();
		held.keep(pair.privateKey);
		const collection = generateCollectionKey(p);
		bin.keep(collection.key);
		const keyIdHex = toHex(collection.keyId);

		const kdf: Kdf = {
			salt: text(salt),
			memoryKiB: params.memoryKiB,
			passes: params.passes,
		};
		const wrapped = (
			wrappingKey: Uint8Array,
			role: SymmetricRole,
			targetId: string,
			key: Uint8Array,
		): EnableWrap => ({
			role,
			targetId,
			wrapped: text(wrapKey(p, wrappingKey, role, targetId, key)),
		});
		const body: EnableBody = {
			authKey: signInSecret(mine.authKey),
			recoveryAuthKey: recovery.recoveryAuthKey,
			kdf,
			publicKey: text(pair.publicKey),
			wraps: [
				wrapped(mine.wrapKey, "ak-password", input.userId, accountKey),
				{
					role: "ak-recovery",
					targetId: input.userId,
					wrapped: recovery.wrapped,
				},
				wrapped(accountKey, "private-key", input.userId, pair.privateKey),
				wrapped(accountKey, "collection-key", keyIdHex, collection.key),
			],
		};

		// Everything else, as text the way it will be sent, opens with the
		// account key (the recovery wrap was checked above).
		const sentWrap = (role: SymmetricRole) =>
			body.wraps.find((w) => w.role === role)?.wrapped ?? "";
		checkOpens(p, bin, {
			wrappingKey: mine.wrapKey,
			role: "ak-password",
			id: input.userId,
			sent: sentWrap("ak-password"),
			expected: accountKey,
		});
		const privateKey = checkOpens(p, bin, {
			wrappingKey: accountKey,
			role: "private-key",
			id: input.userId,
			sent: sentWrap("private-key"),
			expected: pair.privateKey,
		});
		const sentPublic = fromBase64Url(body.publicKey);
		if (
			!sentPublic ||
			sentPublic.length !== KEY_BYTES ||
			!keyPairMatches(p, { publicKey: sentPublic, privateKey })
		)
			throw new KeyFlowError("malformed");
		checkOpens(p, bin, {
			wrappingKey: accountKey,
			role: "collection-key",
			id: keyIdHex,
			sent: sentWrap("collection-key"),
			expected: collection.key,
		});
		let wiped = false;
		return {
			body,
			recoveryKeyText: recovery.recoveryKeyText,
			readBack: (answer) => {
				if (wiped) throw new KeyFlowError("failed");
				checkStoredKeys(
					p,
					{
						userId: input.userId,
						accountKey,
						privateKey: pair.privateKey,
						body,
					},
					answer,
				);
			},
			wipe: () => {
				wiped = true;
				held.wipeAll();
			},
		};
	} catch (error) {
		held.wipeAll();
		throw asKeyFlowError(error);
	} finally {
		bin.wipeAll();
	}
}
