import type { DeviceClient } from "./rpc";

/**
 * A device worker, or null when the dev flag is off. The condition is the
 * literal `process.env.NEXT_PUBLIC_DEV_DEVICE_ENGINE === "1"`, which the build
 * replaces with a constant: with the flag unset the branch and the import in
 * it are dropped, and client.ts, the worker and the engine never ship.
 */
export async function loadDeviceClient(): Promise<DeviceClient | null> {
	if (process.env.NEXT_PUBLIC_DEV_DEVICE_ENGINE === "1") {
		const { spawnDeviceClient } = await import("./client");
		return spawnDeviceClient();
	}
	return null;
}
