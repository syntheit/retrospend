import { runtimeTimeZone } from "@retrospend/domain/time-zone";
import { TAG } from "@retrospend/engine/device";
import { attachHost, type HostScope, sameOriginApi } from "./host";

// The device worker, behind the dev flag NEXT_PUBLIC_DEV_DEVICE_ENGINE=1. Only
// client.ts reaches this file, through a dynamic import the flag guards, so a
// build without the flag leaves it and the engine out. scripts/check-release-
// drop.mjs greps the build for WORKER_TAG here and TAG in the engine core.
// Classic worker (Turbopack strips `type: "module"`): no import statements
// survive at run time, the bundler's runtime loads the chunks.
export const WORKER_TAG = "RetrospendDeviceWorker";

const scope = self as unknown as HostScope & { location: Location };

attachHost(scope, {
	createApi: (fetch) => sameOriginApi(scope.location.origin, fetch),
	// Bound: a worker's fetch throws when called off its global scope.
	fetch: (input, init) => self.fetch(input, init),
	browserZone: runtimeTimeZone,
	// Names and counts only, from the engine; the worker's own tag marks the build.
	warn: (what, detail) =>
		console.warn(`${WORKER_TAG}/${TAG}: ${what}`, detail ?? ""),
});
