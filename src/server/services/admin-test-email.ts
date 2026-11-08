import { TRPCError } from "@trpc/server";
import { env } from "~/env";
import { emailSubject } from "~/server/email-copy";
import {
	getPasswordChangedAlertTemplate,
	getPasswordResetEmailTemplate,
	getTestEmailTemplate,
	getVerificationEmailTemplate,
} from "~/server/email-templates";
import { InMemoryRateLimiter } from "~/server/lib/rate-limiter";
import { logEventAsync } from "./audit.service";

const limiter = new InMemoryRateLimiter();

/**
 * A test email is real mail from the server: 3 a minute per admin, and each
 * one is written to the audit log.
 */
export function guardTestEmail(adminId: string, emailType: string): void {
	if (!limiter.check(`adminTestEmail_${adminId}`, 3, 60_000)) {
		throw new TRPCError({
			code: "TOO_MANY_REQUESTS",
			message: "Too many test emails. Try again in a minute.",
		});
	}
	logEventAsync({
		eventType: "SETTINGS_UPDATED",
		userId: adminId,
		metadata: { action: "admin_test_email", adminId, emailType },
	});
}

/** The subject and page of the sample an admin sends from settings. */
export function adminTestEmail(
	type: "basic" | "password-reset" | "credential-change" | "email-verification",
): { subject: string; html: string } {
	const base =
		env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:1997";
	switch (type) {
		case "password-reset":
			return {
				subject: emailSubject.passwordReset,
				html: getPasswordResetEmailTemplate(
					`${base}/auth/reset-password?token=sample-token`,
				),
			};
		case "credential-change":
			return {
				subject: emailSubject.passwordChanged,
				html: getPasswordChangedAlertTemplate(),
			};
		case "email-verification":
			return {
				subject: emailSubject.verifyEmail,
				html: getVerificationEmailTemplate(
					`${base}/auth/verify?token=sample-token`,
				),
			};
		default:
			return { subject: emailSubject.smtpTest, html: getTestEmailTemplate() };
	}
}
