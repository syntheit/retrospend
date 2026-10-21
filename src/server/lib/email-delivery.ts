import { env } from "~/env";
import { getAppSettings } from "~/server/services/settings";

/**
 * Whether the app can actually send email: SMTP is configured AND the admin
 * has email turned on. Everything that depends on mail going out (signup
 * verification, password resets, email-change confirmation, guest resume
 * links) must use this one check, so "SMTP set but email disabled" behaves
 * exactly like "no SMTP" instead of leaving users stuck waiting for mail.
 */
export async function isEmailDeliveryEnabled(): Promise<boolean> {
	if (!env.SMTP_HOST) return false;
	const settings = await getAppSettings();
	return settings.enableEmail;
}
