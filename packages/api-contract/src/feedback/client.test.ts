import { describe, expect, it } from "vitest";
import { scrubErrorText, scrubReport, scrubScreen, scrubStack } from "./client";

// What must never survive, each with a string a real error could contain.
const ADVERSARIAL: { text: string; gone: string[] }[] = [
	{ text: "Failed to settle: paid 1500 to Lucia", gone: ["1500"] },
	{ text: "refund of 0.00012345 BTC failed", gone: ["0.00012345", "00012345"] },
	{ text: "total 1,234.50 ARS", gone: ["1,234", "234.50"] },
	{ text: 'bad body {"name":"Lucia","amount":1500}', gone: ["Lucia", "1500"] },
	{ text: 'bad list [{"who":"Sam"}, 4]', gone: ["Sam"] },
	{
		text: "GET example.com/api/v1/people/lucia failed",
		gone: ["example.com", "lucia"],
	},
	{
		text: "GET https://my.host.test:8443/x?token=abc1 ",
		gone: ["my.host", "abc1"],
	},
	{ text: "connect 192.168.1.20:2997 refused", gone: ["192.168"] },
	{ text: "user /people/alice not found", gone: ["alice"] },
	{ text: "cannot open /Users/lucia/Documents/x.db", gone: ["lucia"] },
	{ text: "Authorization: Bearer abc.def", gone: ["abc.def"] },
	{ text: "api_key=sk12ab", gone: ["sk12ab"] },
	{ text: "short token k3y9x2 leaked", gone: ["k3y9x2"] },
	{ text: "password hunter2 rejected", gone: ["hunter2"] },
	{ text: "mail to bob@example.com failed", gone: ["bob@", "example.com"] },
	{ text: "account DE89 3704 0044 0532 0130 00", gone: ["3704", "0532"] },
	{ text: "account GB82WEST12345698765432", gone: ["12345698765432", "WEST"] },
	{
		text: "Cannot read properties of undefined (reading 'name')",
		gone: ["'name'"],
	},
	{ text: 'no category called "Groceries"', gone: ["Groceries"] },
	{
		text: "id clx9f2k3j0000abc123def456ghi789jkl012mno345",
		gone: ["clx9f2k3j"],
	},
];

describe("scrubErrorText", () => {
	it.each(ADVERSARIAL)("removes what it should: $text", ({ text, gone }) => {
		const out = scrubErrorText(text, 500);
		for (const piece of gone) expect(out).not.toContain(piece);
		expect(out).not.toMatch(/\d{2,}/);
	});

	it("keeps the error name and the shape of the sentence", () => {
		expect(scrubErrorText("TypeError: x is not a function", 500)).toBe(
			"TypeError: x is not a function",
		);
		expect(scrubErrorText("paid 1500", 500)).toBe("paid #");
	});

	it("reduces an API address to its route template", () => {
		expect(
			scrubErrorText("POST https://me.test/api/v1/expenses/clx123 failed", 500),
		).toBe("POST /api/expenses/:id failed");
	});

	it("is the same when run twice", () => {
		for (const { text } of ADVERSARIAL) {
			const once = scrubErrorText(text, 500);
			expect(scrubErrorText(once, 500)).toBe(once);
		}
	});

	it("cuts to the length it is given", () => {
		expect(scrubErrorText("a ".repeat(400), 50)).toHaveLength(50);
	});
});

describe("scrubStack", () => {
	const stack = [
		"TypeError: paid 1500 to Lucia",
		"    at pay (http://192.168.1.4:8081/index.bundle?platform=ios&dev=true:1234:56)",
		"    at run (/app/node_modules/react/index.js:10:2)",
		"    at go (address at /data/app/index.android.bundle:99:7)",
		"    at someName (native)",
	].join("\n");

	it("keeps file and line of app code only", () => {
		expect(scrubStack(stack, 4000)).toBe(
			"at index.bundle:1234:56\nat index.android.bundle:99:7",
		);
	});

	it("is the same when run twice", () => {
		const once = scrubStack(stack, 4000);
		expect(scrubStack(once, 4000)).toBe(once);
	});
});

describe("scrubScreen", () => {
	it("keeps a route template and drops ids and the query", () => {
		expect(scrubScreen("/(tabs)/activity/[id]")).toBe("/(tabs)/activity/[id]");
		expect(scrubScreen("/(tabs)/activity/clx9f2k3j0000abc123?tab=1")).toBe(
			"/(tabs)/activity/:id",
		);
	});
});

describe("scrubReport", () => {
	it("scrubs every free-text field", () => {
		const out = scrubReport({
			kind: "crash" as const,
			message: "paid 1500 to bob@example.com",
			stack: "TypeError: x\n    at f (index.bundle:5:6)",
			screen: "/people/clx123",
			occurredAt: "2026-10-30T10:00:00.000Z",
		});
		expect(out.message).toBe("paid # to <email>");
		expect(out.stack).toBe("at index.bundle:5:6");
		expect(out.screen).toBe("/people/:id");
	});
});
