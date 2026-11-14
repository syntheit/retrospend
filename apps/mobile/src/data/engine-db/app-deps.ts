import type * as ExpoCrypto from "expo-crypto";
import { deleteExpoFile, openExpoFile } from "./expo-driver";
import { keystore } from "./keystore";
import type { OpenDeps } from "./open";

/**
 * The app's open dependencies. The key comes from the async generator on
 * purpose: `getRandomBytes` falls back to Math.random in a development build
 * that has no native call hook, and a database key must never come from that.
 */
export function appOpenDeps(log: OpenDeps["log"]): OpenDeps {
	return {
		secrets: keystore,
		random: (count) =>
			(require("expo-crypto") as typeof ExpoCrypto).getRandomBytesAsync(count),
		openFile: openExpoFile,
		deleteFile: deleteExpoFile,
		log,
	};
}
