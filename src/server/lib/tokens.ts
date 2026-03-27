import crypto from "crypto";

/** SHA-256 hash a raw token for secure storage/lookup. */
export function hashToken(token: string): string {
	return crypto.createHash("sha256").update(token).digest("hex");
}
