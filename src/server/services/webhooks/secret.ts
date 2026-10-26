import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	hkdfSync,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import { env } from "~/env";

/**
 * Webhook signing secrets. The server must read a secret back to sign each
 * delivery, so it is stored encrypted (AES-256-GCM, key derived from the
 * server's auth secret) and shown to its owner once, when it is created or
 * rotated. A database dump alone does not reveal it.
 */

const SECRET_PREFIX = "whsec_";
const START_LENGTH = 10;

function key(): Buffer {
	return Buffer.from(
		hkdfSync(
			"sha256",
			env.BETTER_AUTH_SECRET,
			"retrospend",
			"webhook-secret",
			32,
		),
	);
}

export function generateWebhookSecret(): { secret: string; start: string } {
	const secret = `${SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
	return { secret, start: secret.slice(0, START_LENGTH) };
}

export function encryptSecret(secret: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key(), iv);
	const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
	return ["v1", iv, body, cipher.getAuthTag()]
		.map((part) =>
			typeof part === "string" ? part : part.toString("base64url"),
		)
		.join(".");
}

export function decryptSecret(stored: string): string {
	const [version, iv, body, tag] = stored.split(".");
	if (version !== "v1" || !iv || !body || !tag)
		throw new Error("Unreadable webhook secret");
	const decipher = createDecipheriv(
		"aes-256-gcm",
		key(),
		Buffer.from(iv, "base64url"),
	);
	decipher.setAuthTag(Buffer.from(tag, "base64url"));
	return Buffer.concat([
		decipher.update(Buffer.from(body, "base64url")),
		decipher.final(),
	]).toString("utf8");
}

const mac = (secret: string, body: string, timestampSeconds: number) =>
	createHmac("sha256", secret)
		.update(`${timestampSeconds}.${body}`)
		.digest("hex");

/** The signature header: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. */
export function signWebhook(
	secret: string,
	body: string,
	timestampSeconds: number,
): string {
	return signWebhookWith([secret], body, timestampSeconds);
}

/**
 * The header for several secrets at once: one `v1` entry each, the current
 * secret first. While a rotated secret is in its grace period a delivery is
 * signed with both, so a receiver that has either one verifies it.
 */
export function signWebhookWith(
	secrets: readonly string[],
	body: string,
	timestampSeconds: number,
): string {
	return [
		`t=${timestampSeconds}`,
		...secrets.map((s) => `v1=${mac(s, body, timestampSeconds)}`),
	].join(",");
}

/**
 * What a receiver does: recompute the MAC over the timestamp and the exact
 * body, compare in constant time and reject a timestamp outside the
 * tolerance (replay). Exported for the tests and the docs.
 */
export function verifyWebhookSignature(
	secret: string,
	header: string,
	body: string,
	options: { toleranceSeconds?: number; nowSeconds?: number } = {},
): boolean {
	const { toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000) } =
		options;
	const parts = header.split(",").map((p) => p.trim().split("="));
	const t = Number(parts.find(([k]) => k === "t")?.[1]);
	if (!Number.isInteger(t)) return false;
	if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
	const expected = Buffer.from(mac(secret, body, t));
	// Any v1 entry may match: the header holds two while a secret is replaced.
	return parts.some(
		([k, v]) =>
			k === "v1" &&
			typeof v === "string" &&
			v.length === expected.length &&
			timingSafeEqual(Buffer.from(v), expected),
	);
}
