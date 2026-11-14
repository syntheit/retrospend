import { refusalOf } from "./reviewRefusal";

describe("refusalOf", () => {
	it("reads the three refusals the server answers a preview or write with", () => {
		for (const code of [
			"share_locked",
			"share_is_correction",
			"share_reject_reverses_payment",
		])
			expect(refusalOf({ status: 409, code })).toBe(code);
	});

	it("is null for any other failure, so the sheet says it could not check", () => {
		expect(refusalOf({ status: 409, code: "conflict" })).toBeNull();
		expect(refusalOf({ status: 500 })).toBeNull();
		expect(refusalOf(new Error("offline"))).toBeNull();
		expect(refusalOf(undefined)).toBeNull();
	});
});
