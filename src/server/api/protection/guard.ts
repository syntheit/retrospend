import { TRPCError } from "@trpc/server";

/**
 * Only an explicit OFF is unprotected. A missing value means the field was
 * not loaded (a stub session, an unmigrated row), and the guard fails closed
 * rather than open. Every state K9 adds later is refused by default too.
 */
export function isProtected(state: unknown): boolean {
	return state !== "OFF";
}

/**
 * A protected account called something that has not been cleared for it. The
 * web shows its own words by `data.problem`; the message is never shown.
 */
export class ProtectedAccountError extends TRPCError {
	constructor() {
		super({ code: "FORBIDDEN", message: "Advanced protection is on" });
	}
}

/** Whether the allowlist names this key. A prototype key never counts. */
export function isAllowed(
	list: Readonly<Record<string, string>>,
	key: string,
): boolean {
	return Object.hasOwn(list, key);
}

/** Refuses a protected account on any key the list does not name. */
export function assertAllowed(
	isProtectedAccount: boolean,
	key: string,
	list: Readonly<Record<string, string>>,
): void {
	if (isProtectedAccount && !isAllowed(list, key))
		throw new ProtectedAccountError();
}
