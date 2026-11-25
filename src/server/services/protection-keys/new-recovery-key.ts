/**
 * Replaces the recovery key of an account that has Advanced protection keys
 * (E2EE K3-3, "Make new key"). The person's device unlocked the account key
 * with the password, made a new recovery key, wrapped the account key under it
 * and opened that wrap again from the key's text before sending; this writes
 * the new recovery wrap and the SHA-256 of the new recovery proof together, so
 * the old key stops working at this commit and not before, and a recovery key
 * made before the proof existed (a null hash) gets one.
 *
 * The check is the current sign-in secret (counted as a try, like every
 * password check). The slow work runs before the transaction; the transaction
 * then takes the credential row lock, requires the stored hash to still be the
 * one that was checked, and writes through `applyKeyChanges` (writer
 * "newRecoveryKey"), whose version compare is the one compare-and-swap of the
 * key set: a rotation, a recovery or an email reset that committed since the
 * caller read the version is a `conflict`, and the client starts again. The
 * recovery commit holds the same set lock and checks the proof under it, so an
 * old recovery key cannot commit once this has landed.
 *
 * Nothing about the password, the sessions or the account key changes, so no
 * session ends. An ids-only audit entry goes in the transaction, and an email
 * goes after it.
 */

import type { NewRecoveryKey } from "@retrospend/api-contract";
import { isSignInSecret } from "@retrospend/crypto";
import { verifyPassword } from "better-auth/crypto";
import { db } from "~/server/db";
import { emailSubject } from "~/server/email-copy";
import { getRecoveryKeyReplacedAlertTemplate } from "~/server/email-templates";
import { spendPasswordTry } from "../account-security.service";
import { ProtectionKeysError, ReleaseError } from "./errors";
import { hasKeySet, lockCredential } from "./password-writes";
import { applyKeyChanges, type KeyChanges } from "./protection-keys.service";
import { bytes, invalid, readCredentialHash, sendNotice } from "./shared";
import { hashRecoveryProof, validateKeyChanges } from "./validate";

/** The request as a key change: the one replaced wrap and the proof that checks it. */
function toKeyChanges(userId: string, body: NewRecoveryKey): KeyChanges {
	if (
		!isSignInSecret(body.currentAuthKey) ||
		!isSignInSecret(body.recoveryAuthKey)
	)
		invalid();
	return {
		baseVersion: body.baseVersion,
		// Only the hash is kept: the proof itself is never stored or logged.
		recoveryHash: hashRecoveryProof(body.recoveryAuthKey),
		put: [
			{
				role: "ak-recovery",
				targetId: userId,
				wrapped: bytes(body.wrappedRecoveryKey),
			},
		],
		remove: [],
	};
}

/** The stored version, or null with no key set. */
async function storedVersion(userId: string): Promise<number | null> {
	const row = await db.protectionKeySet.findUnique({
		where: { userId },
		select: { version: true },
	});
	return row?.version ?? null;
}

export type NewRecoveryKeyResult = { version: number };

/**
 * Throws `ProtectionKeysError` (`invalid_input`; `conflict` for no key set, a
 * stale `baseVersion`, or a hash or key set that changed since it was read),
 * `ReleaseError` (`no_password`, `wrong_proof` for a wrong current key) and
 * `PasswordTriesExceededError`. Keys, proofs and wraps are never logged.
 */
export async function replaceRecoveryKey(input: {
	userId: string;
	sessionId: string;
	body: NewRecoveryKey;
}): Promise<NewRecoveryKeyResult> {
	const { userId, sessionId, body } = input;
	const changes = toKeyChanges(userId, body);
	validateKeyChanges(userId, changes, "newRecoveryKey");

	// A keyless account has nothing to replace; answered before a try is spent.
	if (!(await hasKeySet(db, userId))) throw new ProtectionKeysError("conflict");

	await spendPasswordTry(userId, sessionId);
	const checked = await readCredentialHash(userId);
	if (!checked) throw new ReleaseError("no_password");
	if (
		!(await verifyPassword({ password: body.currentAuthKey, hash: checked }))
	) {
		// Keys removed or rotated since the caller read the version replaced the
		// hash, so the old key no longer matches it: a conflict, not a typo.
		const version = await storedVersion(userId);
		if (version === null || version !== body.baseVersion)
			throw new ProtectionKeysError("conflict");
		throw new ReleaseError("wrong_proof");
	}

	const user = await db.user.findUnique({
		where: { id: userId },
		select: { email: true },
	});
	const done = await db.$transaction(async (tx) => {
		await lockCredential(tx, userId);
		const current = await tx.account.findFirst({
			where: { userId, providerId: "credential" },
			select: { password: true },
		});
		// The hash changed since it was checked: the proof is for an old password.
		// (A removed key set is the version compare's refusal, in applyKeyChanges.)
		if (current?.password !== checked)
			throw new ProtectionKeysError("conflict");
		const { version } = await applyKeyChanges(
			tx,
			userId,
			changes,
			"newRecoveryKey",
		);
		await tx.eventLog.create({
			data: {
				eventType: "USER_UPDATED",
				userId,
				metadata: { reason: "recovery_key_replaced" },
			},
		});
		return { version };
	});
	// After the commit; the mail carries no key material and its failure never fails the request.
	if (user)
		await sendNotice(user.email, {
			subject: emailSubject.recoveryKeyReplaced,
			body: getRecoveryKeyReplacedAlertTemplate,
			failure: "Could not send the recovery key notice",
		});
	return done;
}
