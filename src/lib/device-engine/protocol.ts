import type { DeviceRead, DeviceStatus } from "@retrospend/engine/device";

// The messages between the page and the device worker. Types only: this file
// is in the page's bundle and the worker's, and must never carry the engine.

/**
 * Every failure crosses the boundary as one of these, never as text: a
 * message could carry a name or an amount. The first three are terminal for
 * the account (a retry cannot help); rate_limited is a wait.
 */
export type DeviceErrorCode =
	| "protected_account"
	| "unauthenticated"
	| "forbidden"
	| "rate_limited"
	| "unavailable"
	| "not_started"
	| "bad_request"
	| "worker_dead";

export const TERMINAL_CODES: readonly DeviceErrorCode[] = [
	"protected_account",
	"unauthenticated",
	"forbidden",
];

/** A failure with a fixed code and no message: the only error that crosses the boundary. */
export class DeviceError extends Error {
	constructor(readonly code: DeviceErrorCode) {
		super(code);
		this.name = "DeviceError";
	}
}

/** How the check against the server ended: ids and a count, never an amount. */
export interface VerifyResult {
	mismatchedIds: readonly string[];
	generation: number;
}

export interface PullResult {
	status: DeviceStatus;
	generation: number;
}

export interface Results {
	start: undefined;
	pull: PullResult;
	read: DeviceRead | null;
	verify: VerifyResult | null;
	stop: undefined;
}

export type Request =
	| { type: "start"; userId: string }
	| { type: "pull" }
	| { type: "read"; ids: string[] }
	| { type: "verify"; ids: string[] }
	| { type: "stop" };

export type Envelope = Request & { id: number };

export type Reply =
	| { id: number; ok: true; value: unknown }
	| { id: number; ok: false; code: DeviceErrorCode };
