import {
	ADMIN_FAILURE_CODES,
	type AdminFailureCode,
} from "@retrospend/api-contract/common";

/**
 * The known cause of a failed admin action, by the problem code the server
 * sends (`data.problem`), never by its English message. Each code has its own
 * sentence in `adminPage.failures`. Null for any other failure.
 */
export function adminFailureOf(error: unknown): AdminFailureCode | null {
	const problem = (error as { data?: { problem?: unknown } } | null)?.data
		?.problem;
	return ADMIN_FAILURE_CODES.find((code) => code === problem) ?? null;
}

/** The sentence for a failed admin action, or the fallback when its cause is not known. */
export function adminFailureMessage(
	error: unknown,
	t: (key: `failures.${AdminFailureCode}`) => string,
	fallback: string,
): string {
	const code = adminFailureOf(error);
	return code ? t(`failures.${code}`) : fallback;
}
