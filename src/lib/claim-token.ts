import crypto from "crypto";

/**
 * Stateless signed claim tokens for shadow-profile claim links.
 *
 * A token lets whoever holds it prove that a shadow profile was intentionally
 * shared by its creator, without storing anything in the database (the claim
 * STATE — claimedById/claimedAt — already lives on the shadow_profile row).
 *
 * Format (all base64url, joined by "."):
 *   payload := "<shadowId>:<expiresAtMs>"
 *   token   := base64url(payload) + "." + base64url(HMAC-SHA256(payload, secret))
 *
 * The signing secret is the server's BETTER_AUTH_SECRET — the same secret
 * better-auth uses to sign sessions, so it is guaranteed to be configured.
 */

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function sign(payload: string, secret: string): string {
	return crypto
		.createHmac("sha256", secret)
		.update(payload)
		.digest("base64url");
}

/**
 * Signs a claim token for the given shadow profile id.
 * @param shadowId  ShadowProfile.id to encode.
 * @param secret    Server secret (BETTER_AUTH_SECRET).
 * @param ttlMs     Time-to-live in milliseconds (default 7 days).
 */
export function signClaimToken(
	shadowId: string,
	secret: string,
	ttlMs: number = DEFAULT_TTL_MS,
): string {
	const expiresAt = Date.now() + ttlMs;
	const payload = `${shadowId}:${expiresAt}`;
	const encodedPayload = Buffer.from(payload).toString("base64url");
	return `${encodedPayload}.${sign(payload, secret)}`;
}

export type ClaimTokenResult =
	| { valid: true; shadowId: string; expiresAt: number }
	| { valid: false; reason: "malformed" | "invalid" | "expired" };

/**
 * Verifies a claim token using timing-safe comparison and checks expiry.
 * Returns the decoded shadow id when valid.
 */
export function verifyClaimToken(
	token: string,
	secret: string,
): ClaimTokenResult {
	const parts = token.split(".");
	if (parts.length !== 2) {
		return { valid: false, reason: "malformed" };
	}
	const [encodedPayload, providedSig] = parts as [string, string];

	let payload: string;
	try {
		payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
	} catch {
		return { valid: false, reason: "malformed" };
	}

	const expectedSig = sign(payload, secret);
	let signaturesMatch = false;
	try {
		signaturesMatch = crypto.timingSafeEqual(
			Buffer.from(providedSig),
			Buffer.from(expectedSig),
		);
	} catch {
		signaturesMatch = false;
	}
	if (!signaturesMatch) {
		return { valid: false, reason: "invalid" };
	}

	const sep = payload.lastIndexOf(":");
	if (sep <= 0) {
		return { valid: false, reason: "malformed" };
	}
	const shadowId = payload.slice(0, sep);
	const expiresAt = Number(payload.slice(sep + 1));
	if (!shadowId || !Number.isFinite(expiresAt)) {
		return { valid: false, reason: "malformed" };
	}
	if (Date.now() > expiresAt) {
		return { valid: false, reason: "expired" };
	}

	return { valid: true, shadowId, expiresAt };
}
