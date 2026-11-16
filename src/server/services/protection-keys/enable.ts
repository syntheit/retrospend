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
 * the two-factor code when it is on, and a verified email. What it does after:
 * every other session ends, pending reset links are removed (they would write
 * a hash around the keys), an audit entry (ids only) and an email.
 *
 * The slow work (the password check and the hash) runs before the transaction,
 * so the credential row lock is held briefly; the transaction then swaps the
 * hash only if it is still the one that was checked.
 */

import type { EnableProtection } from "@retrospend/api-contract";
import { fromBase64Url, isSignInSecret } from "@retrospend/crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { db } from "~/server/db";
import { emailSubject } from "~/server/email-copy";
import { getProtectionEnabledAlertTemplate } from "~/server/email-templates";
import { isEmailDeliveryEnabled } from "~/server/lib/email-delivery";
import { sendEmail } from "~/server/mailer";
import {
	deleteResetTokens,
	spendPasswordTry,
} from "../account-security.service";
import { EnableProtectionError, ProtectionKeysError } from "./errors";
import { hasKeySet, lockCredential } from "./password-writes";
import {
	applyKeyChanges,
	getProtectionKeys,
	type KeyChanges,
} from "./protection-keys.service";
import { verifyTwoFactorCode } from "./two-factor";
import { validateKeyChanges } from "./validate";

/** How old the calling session may be, by `session.createdAt`. */
export const FRESH_SESSION_MS = 10 * 60_000;

const WRAP_ROLES = [
	"ak-password",
	"ak-recovery",
	"collection-key",
	"private-key",
];

function invalid(): never {
	throw new ProtectionKeysError("invalid_input");
}

const bytes = (text: string): Uint8Array => fromBase64Url(text) ?? invalid();

/** The request as a key change: exactly the four wraps a new set starts with. */
function toKeyChanges(body: EnableProtection): KeyChanges {
	if (!isSignInSecret(body.authKey)) invalid();
	const roles = body.wraps.map((w) => w.role).sort();
	if (roles.join() !== WRAP_ROLES.join()) invalid();
	return {
		baseVersion: 0,
		set: {
			kdfSalt: bytes(body.kdf.salt),
			kdfMemoryKiB: body.kdf.memoryKiB,
			kdfPasses: body.kdf.passes,
			publicKey: bytes(body.publicKey),
		},
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

/** After the commit: the account hears about it. It carries no data beyond the address it goes to. */
async function sendNotice(email: string): Promise<void> {
	try {
		if (await isEmailDeliveryEnabled())
			await sendEmail(
				email,
				emailSubject.protectionEnabled,
				getProtectionEnabledAlertTemplate(),
			);
	} catch {
		// The keys are made; a mail failure must not fail the request. No detail
		// is logged: an SMTP error can quote the address.
		console.error("Could not send the Advanced protection notice");
	}
}

async function refuseWhenKeyed(userId: string): Promise<void> {
	if (await hasKeySet(db, userId)) throw new ProtectionKeysError("conflict");
}

export async function enableProtection(
	input: { userId: string; sessionId: string; body: EnableProtection },
	now = new Date(),
): Promise<EnableResult> {
	const { userId, sessionId, body } = input;
	const changes = toKeyChanges(body);
	validateKeyChanges(userId, changes);

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
	const credential = await db.account.findFirst({
		where: { userId, providerId: "credential" },
		select: { password: true },
	});
	if (!credential?.password) throw new EnableProtectionError("no_password");
	const checked = credential.password;
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
		const locked = await lockCredential(tx, userId);
		if (!locked || locked.hasKeySet) throw new ProtectionKeysError("conflict");
		// Only the hash that was checked is replaced: another writer got in first otherwise.
		const swapped = await tx.account.updateMany({
			where: { userId, providerId: "credential", password: checked },
			data: { password: hashed },
		});
		if (swapped.count !== 1) throw new ProtectionKeysError("conflict");
		const { version } = await applyKeyChanges(tx, userId, changes);
		const ended = await tx.session.deleteMany({
			where: { userId, id: { not: sessionId } },
		});
		await deleteResetTokens(tx, user.email);
		await tx.eventLog.create({
			data: {
				eventType: "PASSWORD_CHANGED",
				userId,
				metadata: { reason: "protection_keys_created" },
			},
		});
		const keys = await getProtectionKeys(tx, userId);
		return {
			version,
			createdAt: keys?.createdAt ?? now,
			signedOut: ended.count,
		};
	});
	await sendNotice(user.email);
	return done;
}
