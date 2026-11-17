import type { RetrospendClient } from "@retrospend/api-client";
import { deviceEngineModule } from "./deviceEngineModule";

// The dev-only parity capture, behind the engine flag (deviceEngineModule).
// Nothing here may throw into a send, an edit or a delete: the module is
// required inside the try, so even a module-init failure never turns a write
// the server accepted into a retry.

/** Tells the engine a create was accepted, for it to compare after the next pull. */
export function captureSent(
	api: RetrospendClient,
	entry: { clientId: string; entity: string; payload: unknown },
	startedAt: number,
): void {
	try {
		deviceEngineModule()?.captureSent(api, entry, startedAt);
	} catch {
		// Dev-only parity check; the write itself has already succeeded.
	}
}

/**
 * Forgets the capture of this id: the phone is about to edit or delete the
 * row, so the synced row would no longer be what the create booked. Called
 * before the request, so an answer that gets lost changes nothing.
 */
export function dropCaptured(api: object, id: string): void {
	try {
		deviceEngineModule()?.dropCaptured(api, id);
	} catch {
		// Dev-only.
	}
}
