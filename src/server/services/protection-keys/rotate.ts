/**
 * Changes the password of an account that has Advanced protection keys (E2EE
 * K2). The person's device derived the old and the new sign-in secret (the
 * auth key) and rewrapped the account key under the new password; this writes
 * the new hash, the new salt and the new wrap together in one owner
 * transaction. The account key, the private key and the collection keys do not
 * change, so nothing sealed is touched.
 *
 * Two calls. `beginRotation` releases the stored password wrap only to a
 * caller that proves the current auth key (a wrong one is a counted try, so a
 * stolen cookie gets no offline guessing target from it). `rotatePassword`
 * checks the current auth key again, hashes the new one, then swaps the hash
 * only if it is still the one that was checked, under the credential row lock.
 * Every call spends one try (`spendPasswordTry` counts success too), so a
 * session has begin, commit and one automatic retry (another begin and commit)
 * inside its 5 tries.
 *
 * After the commit: every other session ends and pending reset links are
 * removed (inside the transaction), then an ids-only audit entry (also inside)
 * and an email. A stale `baseVersion`, a key set removed by a reset, or a hash
 * that changed since it was checked is a `conflict`: the client starts again.
 */

import type { RotatePassword } from "@retrospend/api-contract";
import { isSignInSecret, toBase64Url } from "@retrospend/crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { db } from "~/server/db";
import { emailSubject } from "~/server/email-copy";
import { getPasswordChangedAlertTemplate } from "~/server/email-templates";
import { spendPasswordTry } from "../account-security.service";
import { ProtectionKeysError, RotatePasswordError } from "./errors";
import {
	hasKeySet,
	lockCredential,
	swapCredentialHash,
} from "./password-writes";
import {
	applyKeyChanges,
	getProtectionKeys,
	type KeyChanges,
} from "./protection-keys.service";
import { bytes, invalid, readCredentialHash, sendNotice } from "./shared";
import { validateKeyChanges } from "./validate";

/** The request as a key change: new parameters and the one replaced wrap. */
function toKeyChanges(userId: string, body: RotatePassword): KeyChanges {
	if (!isSignInSecret(body.currentAuthKey) || !isSignInSecret(body.newAuthKey))
		invalid();
	return {
		baseVersion: body.baseVersion,
		set: {
			kdfSalt: bytes(body.kdf.salt),
			kdfMemoryKiB: body.kdf.memoryKiB,
			kdfPasses: body.kdf.passes,
		},
		put: [
			{
				role: "ak-password",
				targetId: userId,
				wrapped: bytes(body.wrappedAccountKey),
			},
		],
		remove: [],
	};
}

async function credentialHash(userId: string): Promise<string> {
	const hash = await readCredentialHash(userId);
	if (!hash) throw new RotatePasswordError("no_password");
	return hash;
}

/** The stored version, or null with no key set. */
async function storedVersion(userId: string): Promise<number | null> {
	const row = await db.protectionKeySet.findUnique({
		where: { userId },
		select: { version: true },
	});
	return row?.version ?? null;
}

export type BeginResult = {
	version: number;
	kdf: { salt: string; memoryKiB: number; passes: number };
	wrappedAccountKey: string;
};

/**
 * Releases the password wrap and the parameters to a caller that proved the
 * current auth key. The hash and the key set are read together under the
 * credential lock, so the wrap returned belongs to the hash that was checked.
 */
export async function beginRotation(input: {
	userId: string;
	sessionId: string;
	currentAuthKey: string;
}): Promise<BeginResult> {
	const { userId, sessionId, currentAuthKey } = input;
	if (!isSignInSecret(currentAuthKey)) invalid();
	// A keyless account has nothing to rotate; answered before a try is spent.
	if (!(await hasKeySet(db, userId))) throw new ProtectionKeysError("conflict");

	await spendPasswordTry(userId, sessionId);
	const checked = await credentialHash(userId);
	if (!(await verifyPassword({ password: currentAuthKey, hash: checked }))) {
		// A reset that removed the keys since the first look replaced the hash.
		if (!(await hasKeySet(db, userId)))
			throw new ProtectionKeysError("conflict");
		throw new RotatePasswordError("wrong_password");
	}

	return db.$transaction(async (tx) => {
		const locked = await lockCredential(tx, userId);
		if (!locked?.hasKeySet) throw new ProtectionKeysError("conflict");
		const current = await tx.account.findFirst({
			where: { userId, providerId: "credential" },
			select: { password: true },
		});
		// The hash changed since it was checked: the proof is for an old password.
		if (current?.password !== checked)
			throw new ProtectionKeysError("conflict");
		const keys = await getProtectionKeys(tx, userId);
		const wrap = keys?.wraps.find(
			(w) => w.role === "ak-password" && w.targetId === userId,
		);
		if (!keys || !wrap) throw new ProtectionKeysError("conflict");
		return {
			version: keys.version,
			kdf: {
				salt: toBase64Url(keys.kdfSalt),
				memoryKiB: keys.kdfMemoryKiB,
				passes: keys.kdfPasses,
			},
			wrappedAccountKey: toBase64Url(wrap.wrapped),
		};
	});
}

export type RotateResult = { version: number; signedOut: number };

export async function rotatePassword(input: {
	userId: string;
	sessionId: string;
	body: RotatePassword;
}): Promise<RotateResult> {
	const { userId, sessionId, body } = input;
	const changes = toKeyChanges(userId, body);
	validateKeyChanges(userId, changes, "rotate");

	const user = await db.user.findUnique({
		where: { id: userId },
		select: { email: true },
	});
	if (!user) throw new RotatePasswordError("no_password");
	// A keyless account has nothing to rotate; answered before a try is spent.
	if (!(await hasKeySet(db, userId))) throw new ProtectionKeysError("conflict");

	await spendPasswordTry(userId, sessionId);
	const checked = await credentialHash(userId);
	if (
		!(await verifyPassword({ password: body.currentAuthKey, hash: checked }))
	) {
		// Keys removed or rotated since the caller's begin replaced the hash, so
		// the typed password no longer matches it: that is a conflict, not a typo.
		const version = await storedVersion(userId);
		if (version === null || version !== body.baseVersion)
			throw new ProtectionKeysError("conflict");
		throw new RotatePasswordError("wrong_password");
	}
	const hashed = await hashPassword(body.newAuthKey);

	const done = await db.$transaction(async (tx) => {
		const swapped = await swapCredentialHash(tx, {
			userId,
			checked,
			hashed,
			keys: "present",
			keepSessionId: sessionId,
			dropResetLinks: true,
		});
		if (!swapped.ok) throw new ProtectionKeysError("conflict");
		const { version } = await applyKeyChanges(tx, userId, changes, "rotate");
		await tx.eventLog.create({
			data: {
				eventType: "PASSWORD_CHANGED",
				userId,
				metadata: { reason: "protection_keys_rotated" },
			},
		});
		return { version, signedOut: swapped.signedOut };
	});
	await sendNotice(user.email, {
		subject: emailSubject.passwordChanged,
		body: getPasswordChangedAlertTemplate,
		failure: "Could not send the password change notice",
	});
	return done;
}
