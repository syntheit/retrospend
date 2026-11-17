import type { RetrospendClient } from "@retrospend/api-client";
import {
	type DeviceApiOptions,
	fakeDeviceApi as fakeApi,
} from "@retrospend/engine/device-fake";

// The engine package's server double for the device engine, plus the same
// object as the generated client for the code that takes one (engineFor, the
// session). `api` is typed as the DeviceApi port, so the fake is checked
// against what the core needs.
export {
	type DeviceApiOptions,
	expense,
	OWED,
	type Page,
	SETTINGS,
} from "@retrospend/engine/device-fake";

export function fakeDeviceApi(options: DeviceApiOptions = {}) {
	const fake = fakeApi(options);
	return { ...fake, client: fake.api as unknown as RetrospendClient };
}
