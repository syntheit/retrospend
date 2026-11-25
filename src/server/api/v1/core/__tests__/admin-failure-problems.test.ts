import type { ORPCError } from "@orpc/server";
import { ADMIN_FAILURE_CODES, PROBLEM_STATUS } from "@retrospend/api-contract/common";
import { describe, expect, it } from "vitest";

import { AdminFailureError } from "~/server/services/admin-failure";
import { encodeProblem } from "../../errors";
import { toProblem } from "../serve";

const encoded = (error: unknown) =>
	encodeProblem(toProblem(error) as ORPCError<string, unknown>);

describe("an admin action failure as problem+json", () => {
	it.each(ADMIN_FAILURE_CODES)("%s keeps its code, status and fixed sentence", (code) => {
		const failure = new AdminFailureError(code);
		expect(encoded(failure)).toMatchObject({
			status: PROBLEM_STATUS[code],
			code,
			detail: failure.message,
		});
	});

	it("an error it does not know stays a bare internal", () => {
		const out = encoded(new Error("535 ana@example.com rejected"));
		expect(out).toMatchObject({ status: 500, code: "internal" });
		expect(JSON.stringify(out)).not.toContain("ana@");
	});
});
