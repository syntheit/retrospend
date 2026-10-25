import { describe, expect, it } from "vitest";
import { safeRedirect } from "./safe-redirect";

describe("safeRedirect", () => {
	it("keeps same-site paths with their query", () => {
		expect(safeRedirect("/device?user_code=ABCD-1234")).toBe(
			"/device?user_code=ABCD-1234",
		);
		expect(safeRedirect("/people")).toBe("/people");
	});

	it("refuses anything that can leave the site", () => {
		for (const raw of [
			null,
			"",
			"https://evil.example",
			"//evil.example",
			"/\\evil.example",
			"/ok\\..\\evil",
			"/\tevil",
			"javascript:alert(1)",
		]) {
			expect(safeRedirect(raw)).toBe("/home");
		}
	});
});
