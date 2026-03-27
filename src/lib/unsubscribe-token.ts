import crypto from "crypto";

/**
 * Signs an unsubscribe token using HMAC-SHA256.
 * The token is base64url-encoded so it's safe to use in URLs.
 *
 * Format: HMAC(userId + ":" + type, secret)
 */
export function signUnsubscribeToken(
	userId: string,
	type: string,
	secret: string,
): string {
	return crypto
		.createHmac("sha256", secret)
		.update(`${userId}:${type}`)
		.digest("base64url");
}

/**
 * Verifies an unsubscribe token using timing-safe comparison.
 * Returns true if the token is valid, false otherwise.
 */
export function verifyUnsubscribeToken(
	token: string,
	userId: string,
	type: string,
	secret: string,
): boolean {
	const expected = signUnsubscribeToken(userId, type, secret);
	try {
		return crypto.timingSafeEqual(
			Buffer.from(token),
			Buffer.from(expected),
		);
	} catch {
		return false;
	}
}
