import { describe, expect, it } from "vitest";
import { signupError } from "./signup-validation";

const base = {
	inviteRequired: false,
	inviteAccepted: false,
	termsRequired: false,
	termsAccepted: false,
	username: "lucia",
};
const withPassword = (password: string, confirmPassword = password) =>
	signupError({ ...base, password, confirmPassword });

describe("signupError password rules", () => {
	it("names the rule that is broken, in the order the form reports them", () => {
		expect(withPassword("Abcdef1")).toBe("passwordMinLength");
		expect(withPassword("abcdefg1")).toBe("passwordComplexity");
		expect(withPassword(`Aa1${"x".repeat(253)}`)).toBe("passwordMaxLength");
		expect(withPassword("Abcdefg1", "Abcdefg2")).toBe("passwordsDontMatch");
		expect(withPassword("Abcdefg1")).toBeNull();
	});

	it("accepts the longest password the server accepts", () => {
		expect(withPassword(`Aa1${"x".repeat(252)}`)).toBeNull();
	});
});
