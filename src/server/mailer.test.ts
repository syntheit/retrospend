import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));

vi.mock("nodemailer", () => ({
	default: { createTransport: () => ({ sendMail }) },
}));
vi.mock("~/env", () => ({
	env: {
		SMTP_HOST: "smtp.test",
		SMTP_PORT: 587,
		SMTP_USER: "u",
		SMTP_PASSWORD: "p",
		EMAIL_FROM: "from@retrospend.test",
	},
}));
vi.mock("~/server/services/settings", () => ({
	getAppSettings: async () => ({ enableEmail: false }),
}));

import { sendEmail } from "./mailer";

describe("sendEmail logging", () => {
	beforeEach(() => vi.restoreAllMocks());

	it("logs the error class and codes, never the recipient from the SMTP text", async () => {
		const err = Object.assign(new Error("550 victim@example.com unknown"), {
			code: "EENVELOPE",
			responseCode: 550,
		});
		sendMail.mockRejectedValueOnce(err);
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});

		await sendEmail("victim@example.com", "Subject", "<p>hi</p>", true);

		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0]).toHaveLength(1);
		const logged = JSON.stringify(spy.mock.calls[0]);
		expect(logged).not.toContain("victim@example.com");
		expect(logged).not.toContain("unknown");
		expect(logged).toContain("EENVELOPE");
		expect(logged).toContain("550");
	});

	it("does not log the address when email is disabled", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		await sendEmail("victim@example.com", "Subject", "<p>hi</p>");

		expect(spy).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(spy.mock.calls)).not.toContain("victim@example.com");
	});
});
