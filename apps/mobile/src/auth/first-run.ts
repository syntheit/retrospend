import type { KeyValueStore } from "@/data/store";
import type { TokenStore } from "./token-store";

// The Keychain on iOS outlives an uninstall; the SQLite store does not. A
// phone that opens with a token and an empty store is a reinstall, and that
// token belongs to a session the person never chose to keep: it is dropped
// and they sign in again. The marker is written to the store on the first run.

const MARKER = "app:first-run";

/** True when this was the first run and a leftover token was cleared. */
export async function clearStaleTokenOnFirstRun(
	store: KeyValueStore,
	tokens: Pick<TokenStore, "clear">,
): Promise<boolean> {
	if ((await store.get(MARKER)) !== null) return false;
	await tokens.clear();
	await store.set(MARKER, new Date().toISOString());
	return true;
}
