/**
 * The one definition of "protected" for the server and every client. Only an
 * explicit OFF is unprotected. A missing value means the field was not loaded
 * (a stub session, an unmigrated row, a missing user), and the check fails
 * closed rather than open. Every state added later is protected by default.
 */
export function isProtected(state: unknown): boolean {
	return state !== "OFF";
}
