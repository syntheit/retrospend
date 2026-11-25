import nodemailer from "nodemailer";
import { env } from "~/env";

const transporter = env.SMTP_HOST
	? nodemailer.createTransport({
			host: env.SMTP_HOST,
			port: env.SMTP_PORT,
			secure: env.SMTP_PORT === 465,
			auth: {
				user: env.SMTP_USER,
				pass: env.SMTP_PASSWORD,
			},
		})
	: null;

import { AdminFailureError, smtpFailure } from "~/server/services/admin-failure";
import { getAppSettings } from "~/server/services/settings";

/** An SMTP error's class and codes. Its message can quote the recipient ("550 user@x unknown"), so it is never logged. */
function describeSendError(error: unknown): string {
	const e = error as { name?: string; code?: unknown; responseCode?: unknown };
	return `${e.name ?? "Error"}, code ${String(e.code ?? "none")}, response ${String(e.responseCode ?? "none")}`;
}

/**
 * Mail an admin asked for and is waiting on (the settings test): a send that
 * cannot start or fails says why, as an AdminFailureError for a cause it
 * knows. Any other failure is thrown as it is, for the server to log and the
 * client to see as a generic error. Everything else uses sendEmail, which
 * never fails its caller.
 */
export async function sendEmailOrThrow(
	to: string,
	subject: string,
	html: string,
): Promise<void> {
	if (!transporter) throw new AdminFailureError("email_not_configured");
	try {
		await transporter.sendMail({ from: env.EMAIL_FROM, to, subject, html });
	} catch (error) {
		console.error(`[Email Error]: Test email failed (${describeSendError(error)})`);
		throw smtpFailure(error) ?? error;
	}
}

export async function sendEmail(
	to: string,
	subject: string,
	html: string,
	bypassEnabledCheck = false,
	extraHeaders?: Record<string, string>,
) {
	if (!transporter) {
		console.log("[Email Skipped]: SMTP not configured");
		return;
	}

	if (!bypassEnabledCheck) {
		const settings = await getAppSettings();
		if (!settings.enableEmail) {
			console.log("[Email Skipped]: Email disabled by admin");
			return;
		}
	}

	try {
		await transporter.sendMail({
			from: env.EMAIL_FROM,
			to,
			subject,
			html,
			...(extraHeaders ? { headers: extraHeaders } : {}),
		});
	} catch (error) {
		console.error(
			`[Email Error]: Failed to send email (${describeSendError(error)})`,
		);
	}
}
