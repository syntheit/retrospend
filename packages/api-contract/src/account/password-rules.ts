/**
 * The new password rules, in one place: 8 to 255 characters, a lowercase and
 * an uppercase letter, and a number. The server holds every password write
 * to them (changePasswordSchema, the reset, sign-up). For a keyed account
 * the password is never sent, so the clients are the only place the rules are
 * enforced: web and phone import this file, and nothing else spells them.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 255;

const LOWERCASE = /[a-z]/;
const UPPERCASE = /[A-Z]/;
const NUMBER = /\d/;

/** The three rules as one pattern, for the schema and the OpenAPI document. */
export const PASSWORD_PATTERN = new RegExp(
	`(?=.*${LOWERCASE.source})(?=.*${UPPERCASE.source})(?=.*${NUMBER.source})`,
);

/** The rules shown as checks while typing: length, both cases, a number. */
export type PasswordCheck = "length" | "case" | "number";

export const PASSWORD_CHECKS: readonly PasswordCheck[] = [
	"length",
	"case",
	"number",
];

export function passwordChecks(value: string): Record<PasswordCheck, boolean> {
	return {
		length:
			value.length >= PASSWORD_MIN_LENGTH &&
			value.length <= PASSWORD_MAX_LENGTH,
		case: LOWERCASE.test(value) && UPPERCASE.test(value),
		number: NUMBER.test(value),
	};
}

/**
 * The first rule a new password breaks, in the order the forms report them:
 * too short, too long, then a missing case or number. Null when it meets all.
 */
export function passwordFirstIssue(
	value: string,
): "min" | "max" | "complexity" | null {
	if (value.length < PASSWORD_MIN_LENGTH) return "min";
	if (value.length > PASSWORD_MAX_LENGTH) return "max";
	return PASSWORD_PATTERN.test(value) ? null : "complexity";
}

/**
 * Whether a new password meets every rule. It asks the pattern the server
 * schema and the OpenAPI document use, so a client never accepts what the
 * server refuses. (The pattern reads one line, so a password with a line break
 * needs all three kinds on one line; the checks above only light up the rows.)
 */
export function passwordMeetsRules(value: string): boolean {
	return passwordFirstIssue(value) === null;
}

/** The change form can submit: current given, every rule met, both new fields match. */
export function passwordReady(input: {
	current: string;
	next: string;
	confirm: string;
}): boolean {
	return (
		input.current !== "" &&
		passwordMeetsRules(input.next) &&
		input.next === input.confirm
	);
}
