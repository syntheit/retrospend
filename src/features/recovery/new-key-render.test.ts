// Server-rendered markup of the Make new key row's words. The Sheet itself needs
// a DOM; the steps it shows are the enable sheet's (recovery-key-steps.tsx,
// tested in enable-render.test.ts), and the rules are in packages/crypto/test/client-new-key-model.test.ts.
import { NEW_KEY_INITIAL_STATE, newKeyView } from "@retrospend/crypto/client";
import protection from "@retrospend/i18n/messages/en/protection.json";
import { describe, expect, it } from "vitest";

describe("the Make new key words", () => {
	it("are in the catalog for every step the model names", () => {
		const keyOf = (path: string) =>
			path
				.replace(/^protection\./, "")
				.split(".")
				.reduce<unknown>(
					(node, key) => (node as Record<string, unknown>)?.[key],
					protection,
				);
		for (const step of ["password", "saveKey", "confirmKey"] as const) {
			const view = newKeyView({ ...NEW_KEY_INITIAL_STATE, step });
			expect(typeof keyOf(view.title), view.title).toBe("string");
			expect(typeof keyOf(view.primary ?? ""), view.primary ?? "").toBe(
				"string",
			);
		}
	});
});
