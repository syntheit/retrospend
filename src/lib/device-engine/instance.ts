import { createDeviceController, type DeviceController } from "./controller";
import { loadDeviceClient } from "./load";

let controller: DeviceController | null = null;

/** The tab's one controller. */
export function deviceController(): DeviceController {
	controller ??= createDeviceController({
		load: loadDeviceClient,
		now: Date.now,
		visible: () => document.visibilityState === "visible",
		// Ids, counts and zones only: a report never holds an amount.
		onParity: (report) => console.info("device parity", JSON.stringify(report)),
	});
	return controller;
}
