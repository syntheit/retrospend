import { type KeyObject, sign } from "node:crypto";

/**
 * Minimal JWT signing for the three push services: ES256 for APNs provider
 * tokens and VAPID (RFC 8292), RS256 for the Google service account.
 * Signing only; tokens are never parsed here.
 */

const b64 = (value: unknown) =>
	Buffer.from(JSON.stringify(value)).toString("base64url");

export function signJwt(
	alg: "ES256" | "RS256",
	header: Record<string, unknown>,
	claims: Record<string, unknown>,
	key: KeyObject,
): string {
	const input = `${b64({ ...header, alg })}.${b64(claims)}`;
	// JWT wants ECDSA as the raw r||s pair, not DER.
	const signature =
		alg === "ES256"
			? sign("sha256", Buffer.from(input), {
					key,
					dsaEncoding: "ieee-p1363",
				})
			: sign("sha256", Buffer.from(input), key);
	return `${input}.${signature.toString("base64url")}`;
}
