/**
 * What a reset request does once the address is known to belong to an account
 * that may get a link: make the link and mail it. Kept out of the router so
 * the router only validates, limits and answers.
 */
import { randomBytes } from "node:crypto";
import { isProtected } from "@retrospend/api-contract/protection-state";
import { TRPCError } from "@trpc/server";
import { hashPassword } from "better-auth/crypto";
import { env } from "~/env";
import { db } from "~/server/db";
import { emailSubject } from "~/server/email-copy";
import {
	getPasswordResetCodeEmailTemplate,
	getPasswordResetEmailTemplate,
} from "~/server/email-templates";
import { isEmailDeliveryEnabled } from "~/server/lib/email-delivery";
import { sendEmail } from "~/server/mailer";
import { normalizeEmail } from "../protection-keys/prelogin";
import { hasKeySet } from "../protection-keys/password-writes";
import {
	allowResetRequest,
	groupResetCode,
	issueResetCode,
	issueResetToken,
} from "./reset-tokens";

const resetUrl = (token: string) =>
	`${env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:1997"}/auth/reset-password?token=${token}`;

/**
 * Whether the person's own reset link may go out. A keyed account gets it in
 * every state (K3-2b, owner decision 9): with protection OFF a plain reset
 * removes the keys, and with protection on the link leads to recovery with the
 * recovery key while the plain reset still refuses (`protected_password`).
 * Protection on with no key set has nothing to recover and gets none. The
 * admin's link (`makeAdminResetLink`) keeps refusing a protected account: it
 * never opens recovery.
 */
export async function mayGetResetLink(user: {
	id: string;
	protectionState: string | null;
}): Promise<boolean> {
	return !isProtected(user.protectionState) || (await hasKeySet(db, user.id));
}

/**
 * Makes the person's own link and mails it. The mail is not awaited: a slow
 * mail server must not tell a known address from an unknown one, and a failed
 * send is logged without the address (a mail error can carry it). Nothing is
 * sent when the address changed since the caller read the account.
 */
export async function sendResetLink(user: {
	id: string;
	email: string;
}): Promise<void> {
	const token = await issueResetToken({
		userId: user.id,
		origin: "email",
		forEmail: user.email,
	});
	if (!token) return;
	sendEmail(
		user.email,
		emailSubject.passwordReset,
		getPasswordResetEmailTemplate(resetUrl(token)),
	).catch(() => console.error("Failed to send the password reset email"));
}

/**
 * The admin's link for an account: the URL to hand over. Origin "admin", so it
 * resets a password like any link but never opens recovery. A changed address
 * is a conflict: the admin read it a moment ago.
 */
export async function makeAdminResetLink(user: {
	id: string;
	email: string;
}): Promise<string> {
	const token = await issueResetToken({
		userId: user.id,
		origin: "admin",
		forEmail: user.email,
	});
	if (!token)
		throw new TRPCError({
			code: "CONFLICT",
			message: "The account changed meanwhile. Try again.",
		});
	return resetUrl(token);
}

/**
 * Whether a phone code may go out: only to an account whose keys a recovery
 * key can open (a key set with a recovery proof). A code redeems recovery and
 * nothing else, so for any other account it would open nothing.
 */
export async function mayGetResetCode(userId: string): Promise<boolean> {
	const set = await db.protectionKeySet.findUnique({
		where: { userId },
		select: { recoveryHash: true },
	});
	return set?.recoveryHash != null;
}

/**
 * Makes a phone reset code for the person and mails it, not awaited, like the
 * link: a slow mail server must not tell a known address from an unknown one.
 * The mail holds the code and words only, never a name or an address.
 */
export async function sendResetCode(user: {
	id: string;
	email: string;
}): Promise<void> {
	const code = await issueResetCode({ userId: user.id, forEmail: user.email });
	if (!code) return;
	sendEmail(
		user.email,
		emailSubject.passwordResetCode,
		getPasswordResetCodeEmailTemplate(groupResetCode(code)),
	).catch(() => console.error("Failed to send the password reset code email"));
}

/**
 * The whole phone request for one address, shared by every transport. It is
 * counted before the lookup, for every address (the same per-address limit as
 * the web request), and runs one dummy password hash on every path, so a
 * known address, an unknown one, an account without a recovery key and a
 * used-up limit take about the same work and give the same answer: this
 * returns nothing in all of them. Only a disabled mailer is told apart, and
 * that says nothing about the address.
 */
export async function requestResetCode(email: string): Promise<void> {
	if (!(await isEmailDeliveryEnabled()))
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Email functionality is disabled",
		});
	const address = normalizeEmail(email);
	const allowed = await allowResetRequest(address);
	const user = allowed
		? await db.user.findUnique({
				where: { email: address },
				select: { id: true, email: true },
			})
		: null;
	await hashPassword(randomBytes(32).toString("hex"));
	if (!user || !(await mayGetResetCode(user.id))) return;
	await sendResetCode(user);
}
