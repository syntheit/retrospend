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

/** The signature header: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. */
export function signWebhook(
	secret: string,
	body: string,
	timestampSeconds: number,
): string {
	const mac = createHmac("sha256", secret)
		.update(`${timestampSeconds}.${body}`)
		.digest("hex");
	return `t=${timestampSeconds},v1=${mac}`;
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
	const parts = Object.fromEntries(
		header.split(",").map((p) => p.trim().split("=") as [string, string]),
	);
	const t = Number(parts.t);
	if (!Number.isInteger(t) || typeof parts.v1 !== "string") return false;
	if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
	const expected = signWebhook(secret, body, t).split("v1=")[1] ?? "";
	const given = parts.v1;
	return (
		given.length === expected.length &&
		timingSafeEqual(Buffer.from(given), Buffer.from(expected))
	);
}
