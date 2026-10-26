import { describe, expect, it } from "vitest";
import {
	AUTO_DISABLE_AFTER,
	MAX_ATTEMPTS,
	MAX_DELAY_MS,
	retryDelayMs,
} from "./schedule";
import {
	decryptSecret,
	encryptSecret,
	generateWebhookSecret,
	signWebhook,
	signWebhookWith,
	verifyWebhookSignature,
} from "./secret";
import { matchesEventFilter } from "./worker";

describe("webhook secret", () => {
	it("is shown once as whsec_ plus 256 random bits and stored encrypted", () => {
		const { secret, start } = generateWebhookSecret();
		expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
		expect(secret.startsWith(start)).toBe(true);
		const stored = encryptSecret(secret);
		expect(stored).not.toContain(secret.slice(8));
		expect(decryptSecret(stored)).toBe(secret);
		expect(encryptSecret(secret)).not.toBe(stored);
	});

	it("refuses a tampered or unreadable stored secret", () => {
		const stored = encryptSecret("whsec_abc");
		const parts = stored.split(".");
		parts[2] = Buffer.from("tampered").toString("base64url");
		expect(() => decryptSecret(parts.join("."))).toThrow();
		expect(() => decryptSecret("garbage")).toThrow();
	});
});

describe("webhook signature", () => {
	const secret = "whsec_test";
	const body = '{"id":"evt_1","type":"expense.created"}';
	const t = 1_800_000_000;

	it("is HMAC-SHA256 over timestamp, a dot and the exact body", () => {
		// Computed with: printf '%s' '1800000000.<body>' | openssl dgst -sha256 -hmac whsec_test
		expect(signWebhook(secret, body, t)).toBe(
			"t=1800000000,v1=bd0b2d57e367c6c99ee9464b7fe4a789bee9fbff5f48bf780b96f766df7bb2d4",
		);
	});

	it("verifies for the right secret, body and a fresh timestamp", () => {
		const header = signWebhook(secret, body, t);
		expect(
			verifyWebhookSignature(secret, header, body, { nowSeconds: t + 10 }),
		).toBe(true);
	});

	it("fails for a wrong secret, an edited body, a replay and a malformed header", () => {
		const header = signWebhook(secret, body, t);
		const now = { nowSeconds: t + 10 };
		expect(verifyWebhookSignature("whsec_other", header, body, now)).toBe(
			false,
		);
		expect(verifyWebhookSignature(secret, header, `${body} `, now)).toBe(false);
		expect(
			verifyWebhookSignature(secret, header, body, { nowSeconds: t + 301 }),
		).toBe(false);
		expect(verifyWebhookSignature(secret, "v1=abc", body, now)).toBe(false);
		expect(verifyWebhookSignature(secret, "t=x,v1=abc", body, now)).toBe(false);
		expect(verifyWebhookSignature(secret, `t=${t},v1=short`, body, now)).toBe(
			false,
		);
	});
});

describe("webhook signature while a secret is being replaced", () => {
	const body = '{"id":"evt_1"}';
	const t = 1_800_000_000;
	const now = { nowSeconds: t + 5 };

	it("carries one v1 entry per secret, the new one first", () => {
		const header = signWebhookWith(["whsec_new", "whsec_old"], body, t);
		const parts = header.split(",");
		expect(parts[0]).toBe(`t=${t}`);
		expect(parts).toHaveLength(3);
		expect(parts[1]).toBe(signWebhook("whsec_new", body, t).split(",")[1]);
		expect(parts[2]).toBe(signWebhook("whsec_old", body, t).split(",")[1]);
	});

	it("is the plain header when there is one secret", () => {
		expect(signWebhookWith(["whsec_a"], body, t)).toBe(
			signWebhook("whsec_a", body, t),
		);
	});

	it("verifies for either secret, and for no other", () => {
		const header = signWebhookWith(["whsec_new", "whsec_old"], body, t);
		expect(verifyWebhookSignature("whsec_new", header, body, now)).toBe(true);
		expect(verifyWebhookSignature("whsec_old", header, body, now)).toBe(true);
		expect(verifyWebhookSignature("whsec_other", header, body, now)).toBe(
			false,
		);
		expect(verifyWebhookSignature("whsec_old", header, `${body} `, now)).toBe(
			false,
		);
	});
});

describe("retry schedule", () => {
	it("doubles from one minute and caps at six hours", () => {
		const minutes = [1, 2, 4, 8, 16, 32, 64, 128, 256];
		for (const [i, m] of minutes.entries())
			expect(retryDelayMs(i + 1), `after attempt ${i + 1}`).toBe(m * 60_000);
		expect(Math.max(...minutes) * 60_000).toBeLessThan(MAX_DELAY_MS);
		expect(Math.min(60_000 * 2 ** 20, MAX_DELAY_MS)).toBe(MAX_DELAY_MS);
	});

	it("gives up after the last attempt", () => {
		expect(retryDelayMs(MAX_ATTEMPTS - 1)).not.toBeNull();
		expect(retryDelayMs(MAX_ATTEMPTS)).toBeNull();
	});

	it("switches a webhook off after five deliveries ran out of retries", () => {
		expect(AUTO_DISABLE_AFTER).toBe(5);
	});
});

describe("matchesEventFilter", () => {
	it("matches everything for an empty filter, else exact types or a whole resource", () => {
		expect(matchesEventFilter([], "expense.created")).toBe(true);
		expect(matchesEventFilter(["expense.created"], "expense.created")).toBe(
			true,
		);
		expect(matchesEventFilter(["expense.created"], "expense.deleted")).toBe(
			false,
		);
		expect(matchesEventFilter(["expense.*"], "expense.deleted")).toBe(true);
		expect(matchesEventFilter(["expense.*"], "expenses.categorized")).toBe(
			false,
		);
		expect(
			matchesEventFilter(["payment.*", "expense.created"], "payment.recorded"),
		).toBe(true);
	});
});
