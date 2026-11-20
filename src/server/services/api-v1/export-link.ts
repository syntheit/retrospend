import { timingSafeEqual } from "node:crypto";
import { EXPORT_LINK_TTL_MS } from "@retrospend/api-contract";
import { keyedHash } from "~/server/lib/keyed-hash";

/**
 * The token on an export download link: `<expires>.<signature>`. The
 * signature covers the job, the owner and the expiry, with a key derived
 * from the auth secret and used for nothing else. The download route also
 * needs the owner's own credentials, so a leaked link alone opens nothing,
 * and a link for one job never opens another.
 */

const sigOf = (jobId: string, userId: string, expires: number) =>
	keyedHash("exportDownload", `${jobId}.${userId}.${expires}`);

export function signExportLink(
	jobId: string,
	userId: string,
	now = Date.now(),
): { token: string; expiresAt: Date } {
	const expires = now + EXPORT_LINK_TTL_MS;
	return {
		token: `${expires}.${sigOf(jobId, userId, expires)}`,
		expiresAt: new Date(expires),
	};
}

export type LinkCheck = "ok" | "expired" | "invalid";

export function checkExportLink(
	jobId: string,
	userId: string,
	token: string,
	now = Date.now(),
): LinkCheck {
	const [rawExpires, sig, extra] = token.split(".");
	const expires = Number(rawExpires);
	if (
		!rawExpires ||
		!sig ||
		extra !== undefined ||
		!Number.isSafeInteger(expires)
	)
		return "invalid";
	const want = Buffer.from(sigOf(jobId, userId, expires), "hex");
	const got = Buffer.from(sig, "hex");
	if (got.length !== want.length || !timingSafeEqual(got, want))
		return "invalid";
	return expires < now ? "expired" : "ok";
}
