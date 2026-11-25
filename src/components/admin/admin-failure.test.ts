import { ADMIN_FAILURE_CODES } from "@retrospend/api-contract/common";
import { describe, expect, it } from "vitest";
import { adminFailureMessage, adminFailureOf } from "./admin-failure";

const failed = (problem: unknown, message = "Something went wrong") => ({
	message,
	data: { problem },
});

describe("adminFailureOf", () => {
	it.each(ADMIN_FAILURE_CODES)("reads %s from the problem code", (code) => {
		expect(adminFailureOf(failed(code))).toBe(code);
	});

	it("is null for any other failure", () => {
		expect(adminFailureOf(failed("protected_account"))).toBeNull();
		expect(adminFailureOf(failed(null))).toBeNull();
		expect(adminFailureOf(new Error("email_auth_failed"))).toBeNull();
		expect(adminFailureOf(null)).toBeNull();
	});
});

describe("adminFailureMessage", () => {
	const t = (key: string) => `catalog:${key}`;

	it("words a known failure from the catalog, never from the server's message", () => {
		expect(
			adminFailureMessage(failed("backup_running", "raw text"), t, "fallback"),
		).toBe("catalog:failures.backup_running");
	});

	it("uses the fallback for anything else", () => {
		expect(adminFailureMessage(failed(null), t, "fallback")).toBe("fallback");
	});
});
