import type {
	EnableProtection,
	RotatePassword,
} from "@retrospend/api-contract";
import { toBase64Url } from "@retrospend/crypto";
import { env } from "~/env";
import { problem } from "~/server/api/v1/errors";
import { userTransaction } from "~/server/db-tx";
import { enableProtection } from "~/server/services/protection-keys/enable";
import { getKeySet } from "~/server/services/protection-keys/protection-keys.service";
import { releaseWraps } from "~/server/services/protection-keys/release";
import {
	beginRotation,
	rotatePassword,
} from "~/server/services/protection-keys/rotate";
import type { Caller } from "./caller";

/** v1 adapters for /me/protection; the key services do the work. */

export async function enable(caller: Caller, body: EnableProtection) {
	// Offered only where the server turned it on. Sign-in for accounts that
	// already have keys never depends on the flag (prelogin is not gated).
	if (!env.ADVANCED_PROTECTION_ENABLED) throw problem("not_implemented");
	const done = await enableProtection({
		userId: caller.principal.userId,
		sessionId: caller.principal.tokenId,
		body,
	});
	return { ...done, createdAt: done.createdAt.toISOString() };
}

/**
 * Changing the password of an account with keys. Offered only where the server
 * turned Advanced protection on, as enable is; the plain password routes keep
 * refusing a keyed account either way.
 */
export function beginPasswordRotation(caller: Caller, currentAuthKey: string) {
	if (!env.ADVANCED_PROTECTION_ENABLED) throw problem("not_implemented");
	return beginRotation({
		userId: caller.principal.userId,
		sessionId: caller.principal.tokenId,
		currentAuthKey,
	});
}

export function changeKeyedPassword(caller: Caller, body: RotatePassword) {
	if (!env.ADVANCED_PROTECTION_ENABLED) throw problem("not_implemented");
	return rotatePassword({
		userId: caller.principal.userId,
		sessionId: caller.principal.tokenId,
		body,
	});
}

/**
 * The wraps a device opens with the password, to a caller that proves the
 * sign-in secret. Which roles leave is release.ts's rule; the recovery wrap
 * is shown as its digest only.
 */
export async function openKeys(caller: Caller, authKey: string) {
	if (!env.ADVANCED_PROTECTION_ENABLED) throw problem("not_implemented");
	const released = await releaseWraps(caller.principal.userId, {
		kind: "password",
		authKey,
		sessionId: caller.principal.tokenId,
	});
	return {
		version: released.version,
		createdAt: released.createdAt.toISOString(),
		kdf: {
			salt: toBase64Url(released.kdf.salt),
			memoryKiB: released.kdf.memoryKiB,
			passes: released.kdf.passes,
		},
		publicKey: toBase64Url(released.publicKey),
		wraps: released.wraps.map((w) => ({
			id: w.id,
			role: w.role,
			targetId: w.targetId,
			wrapped: toBase64Url(w.wrapped),
		})),
		recoveryWrapDigest: released.recoveryWrapDigest
			? toBase64Url(released.recoveryWrapDigest)
			: null,
	};
}

/** Only the public parameters and the dates: no wrap leaves here. */
export async function readKeys(caller: Caller) {
	const { userId } = caller.principal;
	const keys = await userTransaction(caller.db, userId, (tx) =>
		getKeySet(tx, userId),
	);
	if (!keys) throw problem("not_found");
	return {
		createdAt: keys.createdAt.toISOString(),
		version: keys.version,
		kdf: {
			salt: toBase64Url(keys.kdfSalt),
			memoryKiB: keys.kdfMemoryKiB,
			passes: keys.kdfPasses,
		},
	};
}
