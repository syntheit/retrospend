/**
 * Password and signed-in sessions, shared by the web (profile.changePassword)
 * and /api/v1 (POST /me/password, GET and DELETE /me/sessions). Who may call
 * them is decided by the transport; these act on the caller's own rows only.
 * Runs on the global client with an explicit user filter: session and account
 * rows belong to auth, not to row-level security.
 */
import { TRPCError } from "@trpc/server";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { MOBILE_CLIENT_ID } from "~/server/api/v1/scopes";
import { db } from "~/server/db";
import { consumeRateLimit } from "./api-v1/rate-limit.service";
import {
	hasKeySet,
	lockCredential,
	ProtectedPasswordError,
	endSessions,
	type ResetBy,
	settleKeysForReset,
	swapCredentialHash,
} from "./protection-keys/password-writes";
import {
	deleteUserResetTokens,
	PLAIN_RESET_ORIGINS,
	spendResetToken,
} from "./auth/reset-tokens";

/**
 * A wrong current password is what a stolen session can try, so every try
 * counts: 5 per session in 15 minutes, so one session cannot use up the
 * owner's tries, and a looser 20 per user across all their sessions.
 */
const TRIES = { perSession: 5, perUser: 20, windowMs: 15 * 60_000 } as const;

/** The caller has used their tries; `retryAfterSeconds` says when to come back. */
export class PasswordTriesExceededError extends TRPCError {
	constructor(readonly retryAfterSeconds: number) {
		super({
			code: "TOO_MANY_REQUESTS",
			message: "Too many tries. Try again later.",
		});
	}
}

/**
 * Counts one try at the current password for this session and user. The
 * password change and the Advanced protection turn-on share the counters:
 * both are what a stolen session would guess with.
 */
export async function spendPasswordTry(
	userId: string,
	sessionId: string,
): Promise<void> {
	const session = await consumeRateLimit(
		`pwchange:${userId}:${sessionId}`,
		TRIES.perSession,
		TRIES.windowMs,
	);
	if (!session.allowed)
		throw new PasswordTriesExceededError(session.retryAfterSeconds);
	const user = await consumeRateLimit(
		`pwchange:${userId}`,
		TRIES.perUser,
		TRIES.windowMs,
	);
	if (!user.allowed)
		throw new PasswordTriesExceededError(user.retryAfterSeconds);
}

/**
 * What holding a reset link and guessing at the recovery key can try: 5 per
 * link and a looser 10 per user across their links, in an hour. A link is
 * single use, so a person needs a begin, a commit and one spare.
 */
export const RECOVERY_TRIES = {
	perToken: 5,
	perUser: 10,
	windowMs: 60 * 60_000,
} as const;

/** The caller has used their recovery tries; `retryAfterSeconds` says when to come back. */
export class RecoveryTriesExceededError extends TRPCError {
	constructor(readonly retryAfterSeconds: number) {
		super({
			code: "TOO_MANY_REQUESTS",
			message: "Too many tries. Try again later.",
		});
	}
}

/**
 * Counts one try at the recovery key for this reset link and user. Recovery
 * begin and commit each spend one (the check spends none), after the link was
 * found and before the proof is compared. `tokenHash` is the stored hash of the
 * link, never the raw token, so the counter table never holds a usable secret.
 * The only owner of these limits; the per-IP limit is the route's.
 */
export async function spendRecoveryTry(
	userId: string,
	tokenHash: string,
): Promise<void> {
	const token = await consumeRateLimit(
		`recovery:token:${tokenHash}`,
		RECOVERY_TRIES.perToken,
		RECOVERY_TRIES.windowMs,
	);
	if (!token.allowed)
		throw new RecoveryTriesExceededError(token.retryAfterSeconds);
	const user = await consumeRateLimit(
		`recovery:user:${userId}`,
		RECOVERY_TRIES.perUser,
		RECOVERY_TRIES.windowMs,
	);
	if (!user.allowed)
		throw new RecoveryTriesExceededError(user.retryAfterSeconds);
}

export const WRONG_PASSWORD_MESSAGE = "Current password is incorrect";

/**
 * Changes the password after checking the current one, then signs out every
 * other session of the user (the one making the change stays). The tries are
 * counted before the check (TRIES). Neither password is logged or returned.
 * An account with Advanced protection keys is refused (`protected_password`):
 * its keys are wrapped under the password. The check runs before a try is
 * spent and the password is verified, so that account hears the real reason
 * instead of "incorrect", and again under the credential row lock
 * (swapCredentialHash), so a concurrent enable cannot slip between the verify
 * and the write. The write replaces only the hash that was verified.
 */
export async function changeOwnPassword(input: {
	userId: string;
	keepSessionId: string;
	currentPassword: string;
	newPassword: string;
	/**
	 * The same request already spent its try on this password (the email check
	 * of user.updateProfile), so one request counts once.
	 */
	tryAlreadySpent?: boolean;
}): Promise<{ signedOut: number }> {
	// A keyed account hears the real reason before any try is spent.
	if (await hasKeySet(db, input.userId)) throw new ProtectedPasswordError();
	if (!input.tryAlreadySpent)
		await spendPasswordTry(input.userId, input.keepSessionId);

	const credential = await db.account.findFirst({
		where: { userId: input.userId, providerId: "credential" },
		select: { password: true },
	});
	if (!credential?.password) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Password change is not available for this account",
		});
	}
	const checked = credential.password;
	const valid = await verifyPassword({
		password: input.currentPassword,
		hash: checked,
	});
	if (!valid)
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: WRONG_PASSWORD_MESSAGE,
		});

	const hashed = await hashPassword(input.newPassword);
	const swapped = await db.$transaction((tx) =>
		swapCredentialHash(tx, {
			writer: "change",
			userId: input.userId,
			checked,
			hashed,
			sessions: { keep: input.keepSessionId },
		}),
	);
	if (swapped.ok) return { signedOut: swapped.signedOut };
	if (swapped.refusal === "keys_present") throw new ProtectedPasswordError();
	if (swapped.refusal === "hash_changed")
		throw new TRPCError({
			code: "CONFLICT",
			message: "The password changed meanwhile. Try again.",
		});
	throw new TRPCError({
		code: "BAD_REQUEST",
		message: "Password change is not available for this account",
	});
}

/**
 * Writes a reset password hash (the email reset and the admin reset) and ends
 * every session of the user, in one owner transaction that takes the
 * credential row lock first. An account with protection keys has them removed
 * with the new hash while nothing is sealed, and is refused otherwise
 * (settleKeysForReset). `token` is a reset token, spent first in the same
 * transaction (reset-tokens.ts: a spent, expired or other user's token rolls
 * everything back), and every other pending link of the user goes with the
 * reset. Without a credential account the email reset still ends the
 * sessions (`continue`); the admin reset answers not found and changes nothing.
 */
export async function resetPasswordHash(input: {
	userId: string;
	hashed: string;
	by: ResetBy;
	token?: string;
	whenNoCredential: "continue" | "not_found";
}): Promise<void> {
	await db.$transaction(async (tx) => {
		// The credential row first, then the link, as every other writer takes
		// them (swapCredentialHash locks, then drops links): the reverse order
		// could deadlock with a recovery commit on the same user.
		const locked = await lockCredential(tx, input.userId);
		if (input.token)
			await spendResetToken(tx, {
				token: input.token,
				userId: input.userId,
				origins: PLAIN_RESET_ORIGINS,
			});
		if (locked) {
			await settleKeysForReset(tx, input.userId, locked, input.by);
			await tx.account.updateMany({
				where: { userId: input.userId, providerId: "credential" },
				data: { password: input.hashed },
			});
		} else if (input.whenNoCredential === "not_found") {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "User does not have a credential account",
			});
		}
		await endSessions(tx, input.userId, { endAll: true });
		await deleteUserResetTokens(tx, input.userId);
	});
}

/**
 * Replaces the pending email verification token for an address. Verification
 * tokens are auth data the app role cannot touch, so this runs on the owner
 * connection; the caller passes the signed-in user's own address.
 */
export async function storeEmailVerificationToken(
	identifier: string,
	token: string,
	expires: Date,
): Promise<void> {
	await db.$transaction([
		db.verificationToken.deleteMany({ where: { identifier } }),
		db.verificationToken.create({ data: { identifier, token, expires } }),
	]);
}

export type SessionKind = "web" | "mobile" | "device";

export type OwnSession = {
	id: string;
	kind: SessionKind;
	clientId: string | null;
	userAgent: string | null;
	current: boolean;
	createdAt: Date;
	lastUsedAt: Date;
};

function kindOf(clientId: string | null): SessionKind {
	if (clientId === MOBILE_CLIENT_ID) return "mobile";
	return clientId ? "device" : "web";
}

/** The user's live sessions, most recently used first. Never their tokens. */
export async function listOwnSessions(
	userId: string,
	currentSessionId: string,
	now = new Date(),
): Promise<OwnSession[]> {
	const rows = await db.session.findMany({
		where: { userId, expiresAt: { gt: now } },
		select: {
			id: true,
			clientId: true,
			userAgent: true,
			createdAt: true,
			updatedAt: true,
		},
		orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
	});
	return rows.map((r) => ({
		id: r.id,
		kind: kindOf(r.clientId),
		clientId: r.clientId,
		userAgent: r.userAgent,
		current: r.id === currentSessionId,
		createdAt: r.createdAt,
		lastUsedAt: r.updatedAt,
	}));
}

/**
 * Signs out one of the user's other sessions: its token stops working on its
 * next request. Another user's session, or none, is not found; the current
 * one is refused, since signing out here also clears the device.
 */
export async function endOwnSession(
	userId: string,
	currentSessionId: string,
	sessionId: string,
): Promise<void> {
	if (sessionId === currentSessionId)
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "This is the session you are using. Sign out instead.",
		});
	const { count } = await db.session.deleteMany({
		where: { id: sessionId, userId },
	});
	if (count === 0) throw new TRPCError({ code: "NOT_FOUND" });
}
