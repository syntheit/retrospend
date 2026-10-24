import * as SecureStore from "expo-secure-store";

// Everything the app keeps in the keystore (server URL, bearer token, the
// better-auth cookie and session data) uses one accessibility class: readable
// after the first unlock since boot, so background sync works with the phone
// locked, and never copied to a new device or into a backup.
const OPTIONS: SecureStore.SecureStoreOptions = {
	keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** The subset of expo-secure-store that @better-auth/expo's storage needs. */
export const secureStore = {
	getItem: (key: string) => SecureStore.getItem(key, OPTIONS),
	setItem: (key: string, value: string) =>
		SecureStore.setItem(key, value, OPTIONS),
	getItemAsync: (key: string) => SecureStore.getItemAsync(key, OPTIONS),
	setItemAsync: (key: string, value: string) =>
		SecureStore.setItemAsync(key, value, OPTIONS),
	deleteItemAsync: (key: string) => SecureStore.deleteItemAsync(key, OPTIONS),
};
