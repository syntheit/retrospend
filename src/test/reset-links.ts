import {
	issueResetToken,
	type LinkOrigin,
} from "~/server/services/auth/reset-tokens";
import { adminDb } from "~/test/pg-harness";

/** A reset link for the user's current address; the raw token, as the email would carry it. */
export async function issueLinkFor(
	userId: string,
	origin: LinkOrigin = "email",
	now?: Date,
): Promise<string> {
	const { email } = await adminDb.user.findUniqueOrThrow({
		where: { id: userId },
		select: { email: true },
	});
	const token = await issueResetToken({ userId, origin, forEmail: email, now });
	if (!token) throw new Error("the address changed while making a test link");
	return token;
}
