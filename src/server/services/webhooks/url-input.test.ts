import { createWebhookSchema } from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";

/** A url is stored sealed (D11), so it must never start with the ciphertext marker or carry controls. */
describe("the webhook url input", () => {
	const parse = (url: string) =>
		createWebhookSchema.safeParse({ name: "Ledger", url }).success;

	it("takes an ordinary url", () => {
		expect(parse("https://hooks.example/a/b?token=1")).toBe(true);
	});

	it("refuses a leading U+0001 and a control character inside", () => {
		expect(parse("\u0001https://hooks.example/a")).toBe(false);
		expect(parse("https://hooks.example/\u0007a")).toBe(false);
	});

	it("keeps the length limit", () => {
		expect(parse(`https://hooks.example/${"a".repeat(2048)}`)).toBe(false);
	});
});
