import { createDeviceClient, type DeviceClient, type WorkerLike } from "./rpc";

// The only file that creates the worker. The page reaches it through
// load.ts, a dynamic import the dev flag guards: without the flag this file,
// the worker and the engine are not in the build. The URL is a plain string
// to the browser (a TrustedScriptURL sink under Trusted Types), allowed by
// worker-src 'self' in the page CSP.
export function spawnDeviceClient(): DeviceClient {
	const worker = new Worker(new URL("./worker.ts", import.meta.url));
	return createDeviceClient(worker as unknown as WorkerLike);
}
