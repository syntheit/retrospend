import { describe, expect, it } from "vitest";
import { saveError } from "./error-code";

describe("saveError", () => {
	it("reads the tRPC code, never the message", () => {
		expect(saveError({ data: { code: "CONFLICT" }, message: "x" })).toBe(
			"conflict",
		);
		expect(saveError({ data: { code: "NOT_FOUND" } })).toBe("gone");
		expect(saveError({ data: { code: "FORBIDDEN" } })).toBe("forbidden");
		expect(saveError({ data: { code: "BAD_REQUEST" } })).toBe("other");
		expect(saveError(new Error("Expense not found"))).toBe("other");
		expect(saveError(null)).toBe("other");
	});
});
