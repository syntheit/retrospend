/**
 * The key an account's local state is filed under on this phone: the server
 * and the account id. The outbox and its lock, the read cache, the push
 * state and the background tasks all use it, so there is one place that says
 * how it is written.
 */
export function accountScope(baseUrl: string, meId: string): string {
	return `${baseUrl}|${meId}`;
}
