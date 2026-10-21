import crypto from "crypto";

/**
 * Signed claim tokens for shadow-profile claim links.
 *
 * Nothing is stored in the database. Instead the token is bound to state that
 * already lives there, so it dies when that state changes:
 *
 *   - `version` is the shadow's `updatedAt` (ms) when the link was minted.
 *     Claiming deletes the shadow and editing it bumps `updatedAt`, so a used
 *     link stops working and the creator can revoke outstanding links by
 *     editing the ghost.
 *   - `issuerId` is the user who minted the link. The claim re-checks that this
 *     user still has the rights a claim grants (see `canMintClaimLink`), so a
 *     link stops working if the issuer loses their role or the ghost is added
 *     to a project they don't run.
 *
 * Format (all base64url, joined by "."):
 *   payload := "<shadowId>:<expiresAtMs>:<versionMs>:<issuerId>"
 *   token   := base64url(payload) + "." + base64url(HMAC-SHA256(payload, secret))
 *
 * Tokens in the old two-field format ("<shadowId>:<expiresAtMs>") are treated
 * as expired: they carry no binding, so the issuer has to mint a new link.
 *
 * The signing secret is the server's BETTER_AUTH_SECRET, the same secret
 * better-auth uses to sign sessions, so it is guaranteed to be configured.
 */

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function sign(payload: string, secret: string): string {
	return crypto
		.createHmac("sha256", secret)
		.update(payload)
		.digest("base64url");
}

export interface ClaimTokenBinding {
	/** ShadowProfile.id to encode. */
	shadowId: string;
	/** ShadowProfile.updatedAt (ms) at mint time. */
	version: number;
	/** User.id of the person minting the link. */
	issuerId: string;
}

/**
 * Signs a claim token for the given shadow profile.
 * @param binding  Shadow id, shadow version and issuer (see module docs).
 * @param secret   Server secret (BETTER_AUTH_SECRET).
 * @param ttlMs    Time-to-live in milliseconds (default 7 days).
 */
export function signClaimToken(
	binding: ClaimTokenBinding,
	secret: string,
	ttlMs: number = DEFAULT_TTL_MS,
): string {
	const expiresAt = Date.now() + ttlMs;
	const payload = `${binding.shadowId}:${expiresAt}:${binding.version}:${binding.issuerId}`;
	const encodedPayload = Buffer.from(payload).toString("base64url");
	return `${encodedPayload}.${sign(payload, secret)}`;
}

export type ClaimTokenResult =
	| {
			valid: true;
			shadowId: string;
			expiresAt: number;
			version: number;
			issuerId: string;
	  }
	| { valid: false; reason: "malformed" | "invalid" | "expired" };

/**
 * Verifies a claim token using timing-safe comparison and checks expiry.
 * Returns the decoded binding when valid. Callers must still compare
 * `version` with the shadow's current `updatedAt` and re-check the issuer.
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

	const fields = payload.split(":");
	// Legacy unbound token: genuine, but no longer accepted.
	if (fields.length === 2) {
		return { valid: false, reason: "expired" };
	}
	if (fields.length !== 4) {
		return { valid: false, reason: "malformed" };
	}
	const [shadowId, expiresRaw, versionRaw, issuerId] = fields as [
		string,
		string,
		string,
		string,
	];
	const expiresAt = Number(expiresRaw);
	const version = Number(versionRaw);
	if (
		!shadowId ||
		!issuerId ||
		!Number.isFinite(expiresAt) ||
		!Number.isFinite(version)
	) {
		return { valid: false, reason: "malformed" };
	}
	if (Date.now() > expiresAt) {
		return { valid: false, reason: "expired" };
	}

	return { valid: true, shadowId, expiresAt, version, issuerId };
}
