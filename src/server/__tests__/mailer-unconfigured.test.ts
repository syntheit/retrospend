import { describe, expect, it, vi } from "vitest";

vi.mock("~/env", () => ({ env: {} }));
vi.mock("~/server/services/settings", () => ({ getAppSettings: vi.fn() }));

import { sendEmailOrThrow } from "../mailer";

describe("sendEmailOrThrow without an email server", () => {
	it("says email is not set up", async () => {
		const error = await sendEmailOrThrow("a@b.co", "s", "h").catch(
			(e: unknown) => e,
		);
		expect((error as { problem?: string }).problem).toBe("email_not_configured");
	});
});
