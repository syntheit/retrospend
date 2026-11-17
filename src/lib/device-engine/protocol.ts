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

/** How the check against the server ended: ids and a count, never an amount. */
export interface VerifyResult {
	mismatchedIds: readonly string[];
	generation: number;
}

/**
 * What a check of the glance figures against the server found: ids, counts
 * and the zones, never an amount. `skipped` means the device held nothing it
 * could trust, or did not know its zone yet.
 */
export interface ParityReport {
	/** `failed`: the check itself did not finish (the server's answer did not come). */
	state: "checked" | "skipped" | "failed";
	/** The figures compared. */
	ids: readonly string[];
	mismatchedIds: readonly string[];
	/** Pulls that had finished when the check ended. */
	generation: number;
	/** The zone both sides read the figures in: the one stored in the user's settings. */
	storedZone: string | null;
	browserZone: string | null;
	/** The browser is in another zone than the stored one; the tRPC Home reads in the browser's. */
	zoneDiffers: boolean;
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
	parity: ParityReport;
	stop: undefined;
}

export type Request =
	| { type: "start"; userId: string }
	| { type: "pull" }
	| { type: "read"; ids: string[] }
	| { type: "verify"; ids: string[] }
	| { type: "parity" }
	| { type: "stop" };

export type Envelope = Request & { id: number };

export type Reply =
	| { id: number; ok: true; value: unknown }
	| { id: number; ok: false; code: DeviceErrorCode };
