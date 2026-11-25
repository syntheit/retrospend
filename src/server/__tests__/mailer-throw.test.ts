import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.hoisted(() => vi.fn());
vi.mock("nodemailer", () => ({
	default: { createTransport: () => ({ sendMail }) },
}));
vi.mock("~/env", () => ({
	env: {
		SMTP_HOST: "smtp.example.com",
		SMTP_PORT: 587,
		SMTP_USER: "ana",
		SMTP_PASSWORD: "hunter2",
		EMAIL_FROM: "retrospend@example.com",
	},
}));
vi.mock("~/server/services/settings", () => ({
	getAppSettings: vi.fn().mockResolvedValue({ enableEmail: true }),
}));

import { sendEmail, sendEmailOrThrow } from "../mailer";
import { AdminFailureError } from "../services/admin-failure";

const smtpError = (code: string) =>
	Object.assign(new Error("Invalid login for ana at smtp.example.com"), {
		code,
		name: "Error",
	});

describe("sendEmailOrThrow", () => {
	beforeEach(() => {
		sendMail.mockReset();
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	it.each([
		["EAUTH", "email_auth_failed"],
		["ECONNECTION", "email_unreachable"],
		["ESOCKET", "email_unreachable"],
		["ETIMEDOUT", "email_timeout"],
	])("a %s failure is %s, with none of the server's text", async (code, problem) => {
		sendMail.mockRejectedValue(smtpError(code));
		const error = await sendEmailOrThrow("a@b.co", "s", "<p>h</p>").catch(
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(AdminFailureError);
		expect((error as AdminFailureError).problem).toBe(problem);
		expect((error as Error).message).not.toMatch(/ana|smtp\.example|login/i);
		const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
		expect(logged).toContain(code);
		expect(logged).not.toMatch(/ana|smtp\.example|login/i);
	});

	it("throws a failure it does not know as it is, for the server to log and mask", async () => {
		const unknown = smtpError("EENVELOPE");
		sendMail.mockRejectedValue(unknown);
		await expect(sendEmailOrThrow("a@b.co", "s", "h")).rejects.toBe(unknown);
	});

	it("resolves when the mail went out", async () => {
		sendMail.mockResolvedValue({});
		await expect(sendEmailOrThrow("a@b.co", "s", "h")).resolves.toBeUndefined();
	});

	it("sendEmail still never fails its caller", async () => {
		sendMail.mockRejectedValue(smtpError("EAUTH"));
		await expect(sendEmail("a@b.co", "s", "h")).resolves.toBeUndefined();
	});
});
