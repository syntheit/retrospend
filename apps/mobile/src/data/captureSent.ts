import type { RetrospendClient } from "@retrospend/api-client";
import type * as DeviceEngineModule from "./device-engine";

/**
 * Tells the device engine a create was accepted, under the dev flag
 * EXPO_PUBLIC_DEV_DEVICE_ENGINE=1 only. Like useDeviceEngine.ts the engine
 * module is required only when the flag is set, so Metro folds the variable
 * and every other build leaves the engine, and with it the captured bodies,
 * out of the bundle (scripts/check-release-bundle.sh). It never throws: a
 * failure here must not touch a send.
 */
export function captureSent(
	api: RetrospendClient,
	entry: { clientId: string; entity: string; payload: unknown },
	startedAt: number,
): void {
	const engine: typeof DeviceEngineModule | null =
		process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE === "1"
			? require("./device-engine")
			: null;
	try {
		engine?.captureSent(api, entry, startedAt);
	} catch {
		// Dev-only parity check; the write itself has already succeeded.
	}
}
