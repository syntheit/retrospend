import { serverKey } from "@/lib/origin-key";
import { secureStore } from "@/lib/secure-store";

// The bearer token for API v1 lives in the platform keystore (iOS Keychain,
// Android Keystore), never in the SQLite cache and never in logs. The key
// carries a hash of the server's origin, so a token made for one server is
// never read back for, or sent to, another.

export interface TokenStore {
	get(): Promise<string | null>;
	set(token: string): Promise<void>;
	clear(): Promise<void>;
}

export function tokenKey(baseUrl: string): string {
	return `retrospend.bearer.${serverKey(baseUrl)}`;
}

export function createTokenStore(baseUrl: string): TokenStore {
	const key = tokenKey(baseUrl);
	return {
		get: () => secureStore.getItemAsync(key).catch(() => null),
		set: (token) => secureStore.setItemAsync(key, token),
		clear: () => secureStore.deleteItemAsync(key).catch(() => undefined),
	};
}
