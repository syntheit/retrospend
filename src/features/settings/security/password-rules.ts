/**
 * The new password rules the server enforces (profile.changePassword):
 * 8 or more characters, a lowercase and an uppercase letter, and a number.
 * Shown as checks while typing so the rule is visible, not explained.
 */
export type PasswordCheck = "length" | "case" | "number";

export function passwordChecks(value: string): Record<PasswordCheck, boolean> {
	return {
		length: value.length >= 8 && value.length <= 255,
		case: /[a-z]/.test(value) && /[A-Z]/.test(value),
		number: /\d/.test(value),
	};
}

/** The form can submit: current given, every rule met, both new fields match. */
export function passwordReady(input: {
	current: string;
	next: string;
	confirm: string;
}): boolean {
	const checks = passwordChecks(input.next);
	return (
		input.current !== "" &&
		Object.values(checks).every(Boolean) &&
		input.next === input.confirm
	);
}
