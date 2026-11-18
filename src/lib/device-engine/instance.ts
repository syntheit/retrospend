import { createDeviceController, type DeviceController } from "./controller";
import { loadDeviceClient } from "./load";

let controller: DeviceController | null = null;

/** The tab's one controller. */
export function deviceController(): DeviceController {
	controller ??= createDeviceController({
		load: loadDeviceClient,
		now: Date.now,
		visible: () => document.visibilityState === "visible",
	});
	return controller;
}
