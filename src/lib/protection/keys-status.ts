// Whether the signed-in account has protection keys: GET /me/protection/keys,
// which answers 404 when it has none. The Security row shows it; the keys
// themselves are never read here.

export type KeysStatus = "none" | "keyed";

/** The query key the Security row reads and the enable sheet refreshes. */
export const KEYS_STATUS_KEY = ["protection", "keys-status"] as const;

/** Throws for any answer that is neither "has keys" nor "has none", so the row can say it could not load. */
export async function readKeysStatus(
	fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<KeysStatus> {
	const res = await fetchImpl("/api/v1/me/protection/keys", {
		credentials: "same-origin",
		headers: { accept: "application/json" },
		signal: AbortSignal.timeout(15_000),
	});
	if (res.status === 404) return "none";
	if (res.ok) return "keyed";
	throw new Error("keys status");
}
