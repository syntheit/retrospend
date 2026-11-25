import { readFileSync } from "node:fs";
import { ADMIN_FAILURE_CODES } from "@retrospend/api-contract/common";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import {
	AdminFailureError,
	smtpFailure,
	workerFailure,
} from "../admin-failure";
import { IntegrationError } from "../integration-error";

const smtp = (code: string | undefined) =>
	Object.assign(new Error('550 5.1.1 <ana@example.com> user unknown'), {
		code,
	});

describe("smtpFailure", () => {
	it.each([
		["EAUTH", "email_auth_failed"],
		["ECONNECTION", "email_unreachable"],
		["ESOCKET", "email_unreachable"],
		["EDNS", "email_unreachable"],
		["ETIMEDOUT", "email_timeout"],
	])("%s is %s", (code, problem) => {
		expect(smtpFailure(smtp(code))?.problem).toBe(problem);
	});

	it("leaves a code it does not name, and an error with none, unclassified", () => {
		expect(smtpFailure(smtp("EENVELOPE"))).toBeNull();
		expect(smtpFailure(smtp(undefined))).toBeNull();
		expect(smtpFailure("EAUTH")).toBeNull();
		expect(smtpFailure(null)).toBeNull();
	});
});

describe("workerFailure", () => {
	it("tells a sidecar that did not answer, one that refused and a slow one apart", () => {
		expect(
			workerFailure(new TRPCError({ code: "INTERNAL_SERVER_ERROR" })),
		).toEqual({ kind: "no-answer" });
		expect(workerFailure(new TRPCError({ code: "TIMEOUT" }))).toEqual({
			kind: "timeout",
		});
		expect(
			workerFailure(
				new TRPCError({
					code: "BAD_GATEWAY",
					cause: new IntegrationError("x", 409, "Conflict"),
				}),
			),
		).toEqual({ kind: "refused", status: 409 });
		expect(workerFailure(new TRPCError({ code: "BAD_GATEWAY" }))).toEqual({
			kind: "refused",
			status: undefined,
		});
	});

	it("leaves what is not the sidecar's doing unclassified", () => {
		expect(workerFailure(new Error("boom"))).toBeNull();
		expect(workerFailure(new TRPCError({ code: "NOT_FOUND" }))).toBeNull();
	});
});

describe("admin failure codes", () => {
	const en = JSON.parse(
		readFileSync(
			new URL("../../../../packages/i18n/messages/en/adminPage.json", import.meta.url),
			"utf8",
		),
	) as { failures: Record<string, string> };

	it("each has a fixed sentence for the server and one in the web catalog", () => {
		for (const code of ADMIN_FAILURE_CODES) {
			const error = new AdminFailureError(code);
			expect(error.problem).toBe(code);
			expect(error.message).toBe(en.failures[code]);
		}
		expect(Object.keys(en.failures).sort()).toEqual(
			[...ADMIN_FAILURE_CODES].sort(),
		);
	});
});
