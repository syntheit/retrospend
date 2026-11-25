import type { RetrospendClient } from "@retrospend/api-client";
import type { DeviceBulkWrites, DeviceWrites } from "./device-engine";
import { deviceEngineModule } from "./deviceEngineModule";

/**
 * The device engine's write side for this client, or null: the flag is off, no
 * engine runs for it yet, or the module could not load. The one door the save,
 * edit, delete and preview paths use, so a build without the flag never
 * reaches the engine (the module is required only behind the flag), and a
 * failure here never turns a write the server would take into an error.
 */
export function deviceWrites(api: RetrospendClient): DeviceWrites | null {
	try {
		return deviceEngineModule()?.writesFor(api) ?? null;
	} catch {
		return null;
	}
}

/** The bulk side of `deviceWrites`: the same gate, the same fail-closed. */
export function deviceBulkWrites(
	api: RetrospendClient,
): DeviceBulkWrites | null {
	try {
		return deviceEngineModule()?.bulkWritesFor(api) ?? null;
	} catch {
		return null;
	}
}
