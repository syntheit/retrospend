/**
 * What the password-writing flows of Advanced protection keys (turn-on and
 * rotation) both need: refusing a malformed request, decoding its bytes, reading
 * the stored hash, and the notice mail after the commit. The write itself is
 * `swapCredentialHash` in password-writes.ts.
 */
import { fromBase64Url } from "@retrospend/crypto";
import { db } from "~/server/db";
import { isEmailDeliveryEnabled } from "~/server/lib/email-delivery";
import { sendEmail } from "~/server/mailer";
import { ProtectionKeysError } from "./errors";

export function invalid(): never {
	throw new ProtectionKeysError("invalid_input");
}

export const bytes = (text: string): Uint8Array =>
	fromBase64Url(text) ?? invalid();

/** The stored password hash, or null when the account has none. */
export async function readCredentialHash(
	userId: string,
): Promise<string | null> {
	const credential = await db.account.findFirst({
		where: { userId, providerId: "credential" },
		select: { password: true },
	});
	return credential?.password ?? null;
}

/**
 * After the commit: the account hears about it. The mail carries no data
 * beyond the address it goes to, and a failure never fails the request. No
 * detail is logged: an SMTP error can quote the address.
 */
export async function sendNotice(
	email: string,
	notice: { subject: string; body: () => string; failure: string },
): Promise<void> {
	try {
		if (await isEmailDeliveryEnabled())
			await sendEmail(email, notice.subject, notice.body());
	} catch {
		console.error(notice.failure);
	}
}
