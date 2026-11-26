import { describe, expect, it } from "vitest";
import { env } from "~/env";

describe("unit tests", () => {
	it("send no real mail: the mailer gets no SMTP host", () => {
		expect(env.SMTP_HOST ?? "").toBe("");
	});
});
