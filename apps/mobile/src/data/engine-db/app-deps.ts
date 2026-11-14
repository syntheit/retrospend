import type * as ExpoCrypto from "expo-crypto";
import { deleteExpoFile, openExpoFile } from "./expo-driver";
import type { keystore as Keystore } from "./keystore";
import type { OpenDeps } from "./open";

// The native modules load when a call needs them, so an engine that never
// opens a database (no server, a test) never touches the keystore.
const keystore = (): typeof Keystore => require("./keystore").keystore;

/**
 * The app's open dependencies. The key comes from the async generator on
 * purpose: `getRandomBytes` falls back to Math.random in a development build
 * that has no native call hook, and a database key must never come from that.
 */
export function appOpenDeps(log: OpenDeps["log"]): OpenDeps {
	return {
		secrets: {
			get: (name) => keystore().get(name),
			set: (name, value) => keystore().set(name, value),
			delete: (name) => keystore().delete(name),
		},
		random: (count) =>
			(require("expo-crypto") as typeof ExpoCrypto).getRandomBytesAsync(count),
		openFile: openExpoFile,
		deleteFile: deleteExpoFile,
		log,
	};
}
