// The failure codes the enable sheet's callbacks reject with, shared by the
// web and the phone: what a thrown value reads as, and which codes end the flow.
import { describe, expect, it } from "vitest";
import {
	EnableFailure,
	FAILURE_CODES,
	failureCode,
	isFinalFailure,
} from "../src/client";

describe("failureCode", () => {
	it("reads a code off an EnableFailure and anything else as failed", () => {
		for (const code of FAILURE_CODES)
			expect(failureCode(new EnableFailure(code))).toBe(code);
		expect(failureCode(new Error("boom"))).toBe("failed");
		expect(failureCode("wrongCode")).toBe("failed");
		expect(failureCode(undefined)).toBe("failed");
	});
});

describe("isFinalFailure", () => {
	it("is final only when nothing can be retried", () => {
		expect(isFinalFailure("checkFailed")).toBe(true);
		expect(isFinalFailure("deviceKeysNotSaved")).toBe(true);
		expect(isFinalFailure("notOffered")).toBe(true);
		for (const code of [
			"wrongPassword",
			"wrongCode",
			"tooMany",
			"failed",
		] as const)
			expect(isFinalFailure(code)).toBe(false);
		expect(isFinalFailure(null)).toBe(false);
	});

	it("knows every code", () => {
		const final = FAILURE_CODES.filter((code) => isFinalFailure(code));
		expect(final).toEqual(["notOffered", "checkFailed", "deviceKeysNotSaved"]);
	});
});
