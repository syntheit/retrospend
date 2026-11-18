/**
 * Turns on Advanced protection keys for an account that signs in with a typed
 * password (E2EE K1): the person's device made the keys and a new sign-in
 * secret (the auth key), and this writes them together with the new password
 * hash in one owner transaction. Nothing is sealed here; `protectionState`
 * stays OFF.
 *
 * What it needs first, because a stolen session must not be able to move the
 * account to a password only the thief knows: a session made in the last 10
 * minutes, the current password (counted as a try, like a password change),
 * the two-factor code when it is on, and a verified email. The recovery auth key
 * rides along: only its SHA-256 is stored, so a later recovery can prove the
 * recovery key without the server being able to use it. What it does after:
 * every other session ends, pending reset links are removed (they would write
 * a hash around the keys), an audit entry (ids only) and an email.
 *
 * The slow work (the password check and the hash) runs before the transaction,
 * so the credential row lock is held briefly; the transaction then swaps the
 * hash only if it is still the one that was checked.
 */

import {
	ENABLE_WRAP_ROLES,
	type EnableProtection,
} from "@retrospend/api-contract";
import { isSignInSecret } from "@retrospend/crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { db } from "~/server/db";
import { emailSubject } from "~/server/email-copy";
import { getProtectionEnabledAlertTemplate } from "~/server/email-templates";
import { spendPasswordTry } from "../account-security.service";
import { EnableProtectionError, ProtectionKeysError } from "./errors";
import { hasKeySet, swapCredentialHash } from "./password-writes";
import {
	applyKeyChanges,
	getKeySet,
	type KeyChanges,
} from "./protection-keys.service";
import { bytes, invalid, readCredentialHash, sendNotice } from "./shared";
import { verifyTwoFactorCode } from "./two-factor";
import { hashRecoveryProof, validateKeyChanges } from "./validate";

/** How old the calling session may be, by `session.createdAt`. */
export const FRESH_SESSION_MS = 10 * 60_000;

/** The request as a key change: exactly the four wraps a new set starts with. */
function toKeyChanges(body: EnableProtection): KeyChanges {
	if (!isSignInSecret(body.authKey)) invalid();
	const roles = body.wraps.map((w) => w.role).sort();
	if (roles.join() !== [...ENABLE_WRAP_ROLES].sort().join()) invalid();
	return {
		baseVersion: 0,
		set: {
			kdfSalt: bytes(body.kdf.salt),
			kdfMemoryKiB: body.kdf.memoryKiB,
			kdfPasses: body.kdf.passes,
			publicKey: bytes(body.publicKey),
		},
		// Only the hash is kept: the proof itself is never stored or logged.
		recoveryHash: hashRecoveryProof(body.recoveryAuthKey),
		put: body.wraps.map((w) => ({
			...(w.id && { id: w.id }),
			role: w.role,
			targetId: w.targetId,
			wrapped: bytes(w.wrapped),
		})),
		remove: [],
	};
}

export type EnableResult = {
	version: number;
	createdAt: Date;
	signedOut: number;
};

async function refuseWhenKeyed(userId: string): Promise<void> {
	if (await hasKeySet(db, userId)) throw new ProtectionKeysError("conflict");
}

export async function enableProtection(
	input: { userId: string; sessionId: string; body: EnableProtection },
	now = new Date(),
): Promise<EnableResult> {
	const { userId, sessionId, body } = input;
	const changes = toKeyChanges(body);
	validateKeyChanges(userId, changes, "enable");

	const [user, session] = await Promise.all([
		db.user.findUnique({
			where: { id: userId },
			select: { email: true, emailVerified: true, twoFactorEnabled: true },
		}),
		db.session.findFirst({
			where: { id: sessionId, userId },
			select: { createdAt: true },
		}),
	]);
	if (!user || !session) throw new EnableProtectionError("session_not_fresh");
	if (now.getTime() - session.createdAt.getTime() > FRESH_SESSION_MS)
		throw new EnableProtectionError("session_not_fresh");
	if (!user.emailVerified)
		throw new EnableProtectionError("email_not_verified");
	// A cheap early answer; the transaction decides under the lock.
	await refuseWhenKeyed(userId);

	await spendPasswordTry(userId, sessionId);
	const checked = await readCredentialHash(userId);
	if (!checked) throw new EnableProtectionError("no_password");
	if (
		!(await verifyPassword({ password: body.currentPassword, hash: checked }))
	) {
		// A turn-on that committed since the first look replaced the hash, so the
		// typed password no longer matches it: that is a conflict, not a typo.
		await refuseWhenKeyed(userId);
		throw new EnableProtectionError("wrong_password");
	}
	if (user.twoFactorEnabled) {
		if (!body.totpCode) throw new EnableProtectionError("two_factor_required");
		if (!(await verifyTwoFactorCode(userId, body.totpCode)))
			throw new EnableProtectionError("wrong_two_factor_code");
	}
	const hashed = await hashPassword(body.authKey);

	const done = await db.$transaction(async (tx) => {
		const swapped = await swapCredentialHash(tx, {
			userId,
			checked,
			hashed,
			keys: "absent",
			keepSessionId: sessionId,
			resetLinksFor: user.email,
		});
		if (!swapped.ok) throw new ProtectionKeysError("conflict");
		const { version } = await applyKeyChanges(tx, userId, changes, "enable");
		await tx.eventLog.create({
			data: {
				eventType: "PASSWORD_CHANGED",
				userId,
				metadata: { reason: "protection_keys_created" },
			},
		});
		const keys = await getKeySet(tx, userId);
		return {
			version,
			createdAt: keys?.createdAt ?? now,
			signedOut: swapped.signedOut,
		};
	});
	await sendNotice(user.email, {
		subject: emailSubject.protectionEnabled,
		body: getProtectionEnabledAlertTemplate,
		failure: "Could not send the Advanced protection notice",
	});
	return done;
}
