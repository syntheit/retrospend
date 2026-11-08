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

export const WRONG_PASSWORD_MESSAGE = "Current password is incorrect";

/**
 * Changes the password after checking the current one, then signs out every
 * other session of the user (the one making the change stays). The tries are
 * counted before the check (TRIES). Neither password is logged or returned.
 */
export async function changeOwnPassword(input: {
	userId: string;
	keepSessionId: string;
	currentPassword: string;
	newPassword: string;
}): Promise<{ signedOut: number }> {
	const session = await consumeRateLimit(
		`pwchange:${input.userId}:${input.keepSessionId}`,
		TRIES.perSession,
		TRIES.windowMs,
	);
	if (!session.allowed)
		throw new PasswordTriesExceededError(session.retryAfterSeconds);
	const user = await consumeRateLimit(
		`pwchange:${input.userId}`,
		TRIES.perUser,
		TRIES.windowMs,
	);
	if (!user.allowed)
		throw new PasswordTriesExceededError(user.retryAfterSeconds);

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
	const valid = await verifyPassword({
		password: input.currentPassword,
		hash: credential.password,
	});
	if (!valid)
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: WRONG_PASSWORD_MESSAGE,
		});

	const hashed = await hashPassword(input.newPassword);
	const [, ended] = await db.$transaction([
		db.account.updateMany({
			where: { userId: input.userId, providerId: "credential" },
			data: { password: hashed },
		}),
		db.session.deleteMany({
			where: { userId: input.userId, id: { not: input.keepSessionId } },
		}),
	]);
	return { signedOut: ended.count };
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
