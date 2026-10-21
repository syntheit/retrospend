import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { signClaimToken, verifyClaimToken } from "./claim-token";

const SECRET = "test-secret";
const BINDING = { shadowId: "shadow-1", version: 1700000000000, issuerId: "user-1" };

function legacyToken(shadowId: string, expiresAt: number): string {
	const payload = `${shadowId}:${expiresAt}`;
	const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
	return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

describe("claim tokens", () => {
	it("round-trips the shadow id, version and issuer", () => {
		const result = verifyClaimToken(signClaimToken(BINDING, SECRET), SECRET);
		expect(result).toMatchObject({ valid: true, ...BINDING });
	});

	it("rejects a token signed with another secret", () => {
		const result = verifyClaimToken(signClaimToken(BINDING, "other"), SECRET);
		expect(result).toEqual({ valid: false, reason: "invalid" });
	});

	it("rejects a tampered payload", () => {
		const [, sig] = signClaimToken(BINDING, SECRET).split(".");
		const forged = Buffer.from(`shadow-2:${Date.now() + 10_000}:1:user-1`).toString(
			"base64url",
		);
		expect(verifyClaimToken(`${forged}.${sig}`, SECRET)).toEqual({
			valid: false,
			reason: "invalid",
		});
	});

	it("reports an expired token", () => {
		const token = signClaimToken(BINDING, SECRET, -1);
		expect(verifyClaimToken(token, SECRET)).toEqual({
			valid: false,
			reason: "expired",
		});
	});

	it("treats old unbound tokens as expired even when genuine and in date", () => {
		const token = legacyToken("shadow-1", Date.now() + 60_000);
		expect(verifyClaimToken(token, SECRET)).toEqual({
			valid: false,
			reason: "expired",
		});
	});
});
