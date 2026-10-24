import * as SecureStore from "expo-secure-store";

// The bearer token for API v1 lives in the platform keystore (iOS Keychain,
// Android Keystore), never in the SQLite cache and never in logs.
const TOKEN_KEY = "retrospend.bearer";

export interface TokenStore {
	get(): Promise<string | null>;
	set(token: string): Promise<void>;
	clear(): Promise<void>;
}

export const tokenStore: TokenStore = {
	get: () => SecureStore.getItemAsync(TOKEN_KEY).catch(() => null),
	set: (token) => SecureStore.setItemAsync(TOKEN_KEY, token),
	clear: () => SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined),
};
