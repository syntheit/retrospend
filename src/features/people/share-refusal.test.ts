import { describe, expect, it } from "vitest";
import { shareRefusalOf } from "./share-refusal";

describe("shareRefusalOf", () => {
	it("reads the three refusals from the error's problem code", () => {
		for (const code of [
			"share_locked",
			"share_is_correction",
			"share_reject_reverses_payment",
		])
			expect(shareRefusalOf({ data: { problem: code } })).toBe(code);
	});

	it("is null for any other failure", () => {
		expect(shareRefusalOf({ data: { problem: "rate_out_of_range" } })).toBeNull();
		expect(shareRefusalOf({ data: { problem: null } })).toBeNull();
		expect(shareRefusalOf(new Error("boom"))).toBeNull();
		expect(shareRefusalOf(null)).toBeNull();
	});
});
