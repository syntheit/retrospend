import type {
	CompareReport,
	DeviceRead,
	DeviceStatus,
	NarrowValues,
	ScreenName,
} from "@retrospend/engine/device";

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
	// The browser's cookie now belongs to another account than the engine's.
	| "account_changed"
	| "rate_limited"
	| "unavailable"
	| "not_started"
	| "bad_request"
	| "worker_dead";

export const TERMINAL_CODES: readonly DeviceErrorCode[] = [
	"protected_account",
	"unauthenticated",
	"forbidden",
	"account_changed",
];

/** A failure with a fixed code and no message: the only error that crosses the boundary. */
export class DeviceError extends Error {
	constructor(readonly code: DeviceErrorCode) {
		super(code);
		this.name = "DeviceError";
	}
}

export interface PullResult {
	status: DeviceStatus;
	generation: number;
}

export interface Results {
	start: undefined;
	pull: PullResult;
	read: DeviceRead | null;
	/** The device's figures held against the server's (ids and counts only), or null when the check could not run. */
	compare: CompareReport | null;
	stop: undefined;
}

export type Request =
	| { type: "start"; userId: string }
	| { type: "pull" }
	| { type: "read"; ids: string[] }
	| { type: "compare"; screen: ScreenName; values?: NarrowValues }
	| { type: "stop" };

export type Envelope = Request & { id: number };

export type Reply =
	| { id: number; ok: true; value: unknown }
	| { id: number; ok: false; code: DeviceErrorCode };
