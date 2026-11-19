/**
 * What a reset request does once the address is known to belong to an account
 * that may get a link: make the link and mail it. Kept out of the router so
 * the router only validates, limits and answers.
 */
import { TRPCError } from "@trpc/server";
import { env } from "~/env";
import { emailSubject } from "~/server/email-copy";
import { getPasswordResetEmailTemplate } from "~/server/email-templates";
import { sendEmail } from "~/server/mailer";
import { issueResetToken } from "./reset-tokens";

const resetUrl = (token: string) =>
	`${env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:1997"}/auth/reset-password?token=${token}`;

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
