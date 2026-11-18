import { passwordChecks } from "@retrospend/api-contract";

export type SignupErrorKey =
	| "pleaseEnterValidInviteCode"
	| "mustAgreeToTerms"
	| "usernameRequired"
	| "usernameAlphanumericOnly"
	| "passwordMinLength"
	| "passwordComplexity"
	| "passwordsDontMatch";

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
	const checks = passwordChecks(input.password);
	if (!checks.length) return "passwordMinLength";
	if (!checks.case || !checks.number) return "passwordComplexity";
	if (input.password !== input.confirmPassword) return "passwordsDontMatch";
	return null;
}
