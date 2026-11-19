import {
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	passwordFirstIssue,
} from "@retrospend/api-contract";

export type SignupErrorKey =
	| "pleaseEnterValidInviteCode"
	| "mustAgreeToTerms"
	| "usernameRequired"
	| "usernameAlphanumericOnly"
	| "passwordMinLength"
	| "passwordMaxLength"
	| "passwordComplexity"
	| "passwordsDontMatch";

/** The numbers the password messages name, so the catalog never hardcodes them. */
export const SIGNUP_ERROR_VALUES = {
	min: PASSWORD_MIN_LENGTH,
	max: PASSWORD_MAX_LENGTH,
};

// First failing check wins, in the order the form reports them.
export function signupError(input: {
	inviteRequired: boolean;
	inviteAccepted: boolean;
	termsRequired: boolean;
	termsAccepted: boolean;
	username: string;
	password: string;
	confirmPassword: string;
}): SignupErrorKey | null {
	if (input.inviteRequired && !input.inviteAccepted) {
		return "pleaseEnterValidInviteCode";
	}
	if (input.termsRequired && !input.termsAccepted) return "mustAgreeToTerms";
	if (!input.username.trim()) return "usernameRequired";
	if (!/^[a-zA-Z0-9]+$/.test(input.username.trim())) {
		return "usernameAlphanumericOnly";
	}
	const issue = passwordFirstIssue(input.password);
	if (issue === "min") return "passwordMinLength";
	if (issue === "max") return "passwordMaxLength";
	if (issue === "complexity") return "passwordComplexity";
	if (input.password !== input.confirmPassword) return "passwordsDontMatch";
	return null;
}
