/**
 * Account recovery with the recovery key, for a person who forgot the password
 * (E2EE K3-2a; docs/roadmap/e2ee-k1-k3.md, decision 5 and critic 5, 6, 8). The
 * reset email is the way in: a live link the person asked for says whose
 * account this is, and the recovery key proves they still hold the keys. The
 * routes (K3-2b) call these three functions; none of them reads a session.
 *
 * - `checkRecovery`: what the link leads to. Spends no try and releases no wrap.
 * - `beginRecovery`: the ak-recovery and private-key wraps, to a caller that
 *   holds the link and the recovery proof (release.ts owns the proof and which
 *   wraps leave). Spends one recovery try.
 * - `commitRecovery`: the new password. Checks the link and the proof again
 *   (spending one more try; it does not trust begin; and once more under the
 *   set lock, so a hash changed meanwhile is refused), then in one owner
 *   transaction spends the link, swaps the password hash, replaces the
 *   ak-password wrap and the parameters, ends every session and deletes the
 *   account's API keys. Everything or nothing: a refusal anywhere leaves the
 *   link, the hash, the keys and the sessions as they were.
 *
 * Order on every call: find the link by its hash (an unknown, expired, spent
 * or admin-made link is the one 404), spend a recovery try, then compare the
 * proof. The proof is 256 bits, so the compare is a SHA-256 and no slow hash
 * runs before it passes. The new password is hashed only after the proof held.
 * Wraps, proofs and tokens are never logged.
 */
import type {
	Recover,
	RecoverResult,
	RecoveryWrapRole,
} from "@retrospend/api-contract";
import { isSignInSecret } from "@retrospend/crypto";
import { hashPassword } from "better-auth/crypto";
import { isProtected } from "@retrospend/api-contract/protection-state";
import { db } from "~/server/db";
import { emailSubject } from "~/server/email-copy";
import { getPasswordRecoveredAlertTemplate } from "~/server/email-templates";
import { hashToken } from "~/server/lib/tokens";
import { deleteAllAccessTokens } from "../api-v1/token.service";
import {
	InvalidResetTokenError,
	RECOVERY_ORIGINS,
	resolveRecoveryToken,
	spendResetToken,
} from "../auth/reset-tokens";
import { ProtectionKeysError, ReleaseError } from "./errors";
import { lockCredential, swapCredentialHash } from "./password-writes";
import { applyKeyChanges, type KeyChanges } from "./protection-keys.service";
import { checkRecoveryProof, proveRecovery, releaseWraps } from "./release";
import { bytes, invalid, readCredentialHash, sendNotice } from "./shared";
import { validateKeyChanges } from "./validate";

/** The userId a link opens recovery for, or the one 404 for every other link. */
async function userOfLink(token: string): Promise<string> {
	const found = await resolveRecoveryToken(token);
	if (!found) throw new InvalidResetTokenError();
	return found.userId;
}

export type RecoveryCheck = {
	/** `none`: no key set (the plain reset). `noRecovery`: a set made before the recovery proof existed. */
	keys: "none" | "recovery" | "noRecovery";
	protectionOn: boolean;
};

/** What the link leads to. Spends no try: it shows no secret and checks no proof. */
export async function checkRecovery(token: string): Promise<RecoveryCheck> {
	const userId = await userOfLink(token);
	const [set, user] = await Promise.all([
		db.protectionKeySet.findUnique({
			where: { userId },
			select: { recoveryHash: true },
		}),
		db.user.findUnique({
			where: { id: userId },
			select: { protectionState: true },
		}),
	]);
	const keys = !set ? "none" : set.recoveryHash ? "recovery" : "noRecovery";
	return { keys, protectionOn: isProtected(user?.protectionState ?? null) };
}

export type RecoveryBegin = {
	userId: string;
	version: number;
	publicKey: Uint8Array;
	/** The ak-recovery and private-key wraps, and nothing else. */
	wraps: { role: RecoveryWrapRole; targetId: string; wrapped: Uint8Array }[];
};

/**
 * The wraps the recovery key opens, to a caller that holds a live link and the
 * recovery proof. Throws `InvalidResetTokenError` (the link),
 * `RecoveryTriesExceededError`, and `ReleaseError` (`no_keys`,
 * `recovery_unavailable`, `wrong_proof`).
 */
export async function beginRecovery(input: {
	token: string;
	recoveryAuthKey: string;
}): Promise<RecoveryBegin> {
	const userId = await userOfLink(input.token);
	const released = await releaseWraps(userId, {
		reader: "recoveryBegin",
		recoveryAuthKey: input.recoveryAuthKey,
		tokenHash: hashToken(input.token),
	});
	return {
		userId,
		version: released.version,
		publicKey: released.publicKey,
		wraps: released.wraps.map((w) => ({
			role: w.role,
			targetId: w.targetId,
			wrapped: w.wrapped,
		})),
	};
}

/** The new parameters and the one replaced wrap (the recovery wrap stays as it is). */
function toKeyChanges(userId: string, body: Recover): KeyChanges {
	if (!isSignInSecret(body.newAuthKey)) invalid();
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

/**
 * Sets the new password. Throws `InvalidResetTokenError` (the link, also when
 * it was spent by the time the transaction ran), `RecoveryTriesExceededError`,
 * `ReleaseError` (`no_keys`, `recovery_unavailable`, `wrong_proof`,
 * `no_password`), and `ProtectionKeysError` (`invalid_input`; `conflict` for a
 * stale `baseVersion`, a key set removed or a hash that changed since it was
 * read: the client starts again). The "password changed" mail goes after the
 * commit and its failure never fails the request.
 */
export async function commitRecovery(input: Recover): Promise<RecoverResult> {
	const userId = await userOfLink(input.token);
	const changes = toKeyChanges(userId, input);
	validateKeyChanges(userId, changes, "recovery");

	// Before any slow work: the proof holds or nothing else runs.
	await proveRecovery(db, {
		userId,
		tokenHash: hashToken(input.token),
		recoveryAuthKey: input.recoveryAuthKey,
	});
	const checked = await readCredentialHash(userId);
	if (!checked) throw new ReleaseError("no_password");
	const hashed = await hashPassword(input.newAuthKey);
	const user = await db.user.findUnique({
		where: { id: userId },
		select: { email: true },
	});

	const done = await db.$transaction(async (tx) => {
		// The credential row first, then the link, as every other writer takes
		// them (a reverse order could deadlock with a rotation or a reset).
		await lockCredential(tx, userId);
		await spendResetToken(tx, {
			token: input.token,
			userId,
			origins: RECOVERY_ORIGINS,
		});
		const swapped = await swapCredentialHash(tx, {
			writer: "recovery",
			userId,
			checked,
			hashed,
			sessions: { endAll: true },
			dropResetLinks: true,
		});
		if (!swapped.ok) {
			if (swapped.refusal === "no_credential")
				throw new ReleaseError("no_password");
			// The keys went, or the hash moved, since they were read.
			throw new ProtectionKeysError("conflict");
		}
		const { version } = await applyKeyChanges(tx, userId, changes, "recovery");
		// The set row is locked now: the proof must still be the one it holds. A
		// writer that changed the hash since the check above is a refusal, not
		// something the version compare alone is trusted to catch.
		await checkRecoveryProof(tx, {
			userId,
			recoveryAuthKey: input.recoveryAuthKey,
		});
		await deleteAllAccessTokens(tx, userId);
		await tx.eventLog.create({
			data: {
				eventType: "PASSWORD_CHANGED",
				userId,
				metadata: { reason: "protection_keys_recovered" },
			},
		});
		return { version, signedOut: swapped.signedOut };
	});
	if (user)
		await sendNotice(user.email, {
			subject: emailSubject.passwordRecovered,
			body: getPasswordRecoveredAlertTemplate,
			failure: "Could not send the password recovery notice",
		});
	return done;
}
