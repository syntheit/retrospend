import { createHmac, timingSafeEqual } from "node:crypto";
import { EXPORT_LINK_TTL_MS } from "@retrospend/api-contract";
import { env } from "~/env";

/**
 * The token on an export download link: `<expires>.<signature>`. The
 * signature covers the job, the owner and the expiry, with a key derived
 * from the auth secret and used for nothing else. The download route also
 * needs the owner's own credentials, so a leaked link alone opens nothing,
 * and a link for one job never opens another.
 */

let key: Buffer | undefined;
function keyOf(): Buffer {
	key ??= createHmac("sha256", env.BETTER_AUTH_SECRET)
		.update("api-v1-export-download")
		.digest();
	return key;
}

const sigOf = (jobId: string, userId: string, expires: number) =>
	createHmac("sha256", keyOf())
		.update(`${jobId}.${userId}.${expires}`)
		.digest("hex");

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
	if (!rawExpires || !sig || extra !== undefined || !Number.isSafeInteger(expires))
		return "invalid";
	const want = Buffer.from(sigOf(jobId, userId, expires), "hex");
	const got = Buffer.from(sig, "hex");
	if (got.length !== want.length || !timingSafeEqual(got, want))
		return "invalid";
	return expires < now ? "expired" : "ok";
}
