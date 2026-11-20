/**
 * Pins the output of the two tokens that HMAC under the raw secret with no
 * purpose label (base64url). They are the exception to src/server/lib/keyed-hash.ts:
 * moving them would void every claim link and unsubscribe link already sent, so
 * it waits for a dual-verify window the owner schedules. Expected values are
 * literals computed outside this code with node's crypto.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { signClaimToken } from "./claim-token";
import {
	signUnsubscribeToken,
	verifyUnsubscribeToken,
} from "./unsubscribe-token";

const SECRET = "pin-secret-0123456789abcdef";

afterEach(() => vi.useRealTimers());

describe("raw secret tokens", () => {
	it("signs an unsubscribe token as HMAC(secret, 'userId:type'), base64url", () => {
		const token = signUnsubscribeToken("user1", "email", SECRET);
		expect(token).toBe("8ZqilKZ7ZUy867zRMX3wnjkUOagMPhmacQTtYO-OJ1k");
		expect(verifyUnsubscribeToken(token, "user1", "email", SECRET)).toBe(true);
	});

	it("signs a claim token as base64url(payload) and HMAC(secret, payload)", () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_800_000_000_000);
		const token = signClaimToken(
			{ shadowId: "shadow1", version: 1_799_999_999_000, issuerId: "issuer1" },
			SECRET,
			600_000,
		);
		expect(token).toBe(
			`${Buffer.from("shadow1:1800000600000:1799999999000:issuer1").toString("base64url")}.mh350rKmr4F-jdMLIr_ZsDEpxcoH7IcuQD0F_UobTws`,
		);
	});
});
