import { APIError } from "better-auth/api";
import { authenticatingSessionToken } from "~/server/better-auth/scoped-sessions";
import { db } from "~/server/db";
import {
	PasswordTriesExceededError,
	spendPasswordTry,
} from "~/server/services/account-security.service";

/**
 * better-auth's two-factor routes that check the account password. They are
 * what a stolen cookie could guess with, so each call that carries a password
 * spends one of the session's tries, the same counters as a password change.
 */
export const PASSWORD_CHECKING_PATHS = [
	"/two-factor/enable",
	"/two-factor/disable",
	"/two-factor/get-totp-uri",
	"/two-factor/generate-backup-codes",
] as const;

/**
 * Runs in hooks.before, which better-auth calls before the bearer plugin turns
 * a bearer into a cookie, so the session is found from the tokens directly
 * (authenticatingSessionToken), not through getSession.
 */
export async function spendTryForPasswordCheck(input: {
	path: string;
	body: unknown;
	headers: Headers;
	cookieName: string;
}): Promise<void> {
	if (!(PASSWORD_CHECKING_PATHS as readonly string[]).includes(input.path))
		return;
	const password = (input.body as { password?: unknown } | null)?.password;
	if (typeof password !== "string" || password === "") return;
	const token = authenticatingSessionToken(input.headers, input.cookieName);
	if (!token) return;
	const session = await db.session.findFirst({
		where: { token, expiresAt: { gt: new Date() } },
		select: { id: true, userId: true },
	});
	// No session: the route answers 401 itself.
	if (!session) return;
	try {
		await spendPasswordTry(session.userId, session.id);
	} catch (error) {
		if (!(error instanceof PasswordTriesExceededError)) throw error;
		throw new APIError(
			"TOO_MANY_REQUESTS",
			{ message: "Too many tries. Try again later." },
			{ "Retry-After": String(error.retryAfterSeconds) },
		);
	}
}
