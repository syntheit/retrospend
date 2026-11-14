import { secureStore } from "@/lib/secure-store";
import type { SecretStore } from "./secrets";

/** The platform keystore (iOS Keychain, Android Keystore) as the engine's secret store. */
export const keystore: SecretStore = {
	get: async (name) => (await secureStore.getItemAsync(name)) ?? null,
	set: (name, value) => secureStore.setItemAsync(name, value),
	delete: (name) => secureStore.deleteItemAsync(name),
};
