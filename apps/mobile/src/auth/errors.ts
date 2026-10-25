// What a failed sign-in step means to the person, from better-auth's error
// shape ({ status, code?, message? }). Copy lives in the message catalog under
// mobile.signIn.error.<reason>.

export type AuthFailure =
	| "invalidCredentials"
	| "invalidCode"
	| "emailNotVerified"
	| "rateLimited"
	| "network"
	| "unknown";

interface AuthErrorShape {
	status?: number;
	code?: string;
	message?: string;
}

/**
 * Whether an API v1 error means this phone's session is over: 401 (no valid
 * token) or 403 (the account or the token is no longer allowed in).
 */
export function isSessionEnded(error: unknown): boolean {
	const status = (error as { status?: number } | null)?.status;
	return status === 401 || status === 403;
}

export function authFailureOf(error: AuthErrorShape | null | undefined) {
	const code = (error?.code ?? "").toUpperCase();
	if (error?.status === 429) return "rateLimited" as const;
	if (code.includes("EMAIL_NOT_VERIFIED")) return "emailNotVerified" as const;
	if (code.includes("INVALID_CODE") || code.includes("INVALID_TWO_FACTOR")) {
		return "invalidCode" as const;
	}
	if (
		code.includes("INVALID_EMAIL_OR_PASSWORD") ||
		code.includes("INVALID_PASSWORD") ||
		code.includes("USER_NOT_FOUND")
	) {
		return "invalidCredentials" as const;
	}
	if (error?.status === 401) return "invalidCredentials" as const;
	return "unknown" as const;
}
