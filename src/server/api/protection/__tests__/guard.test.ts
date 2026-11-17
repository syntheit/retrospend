import { describe, expect, it } from "vitest";
import { TRPC_ALLOWED } from "../allowed";
import { assertAllowed, isAllowed, ProtectedAccountError } from "../guard";

describe("assertAllowed", () => {
	const list = { "profile.getMyAvatar": "Identity: the profile picture" };

	it("lets an unprotected account call anything", () => {
		expect(() => assertAllowed(false, "expense.listV2", list)).not.toThrow();
	});

	it("lets a protected account call what the list names", () => {
		expect(() =>
			assertAllowed(true, "profile.getMyAvatar", list),
		).not.toThrow();
	});

	it("refuses a protected account anything else, as a forbidden error", () => {
		const error = (() => {
			try {
				assertAllowed(true, "expense.listV2", list);
			} catch (e) {
				return e;
			}
		})();
		expect(error).toBeInstanceOf(ProtectedAccountError);
		expect((error as ProtectedAccountError).code).toBe("FORBIDDEN");
	});

	it("does not read a key off the object's prototype", () => {
		expect(isAllowed(TRPC_ALLOWED, "constructor")).toBe(false);
		expect(isAllowed(TRPC_ALLOWED, "toString")).toBe(false);
		expect(() => assertAllowed(true, "__proto__", list)).toThrow(
			ProtectedAccountError,
		);
	});
});
