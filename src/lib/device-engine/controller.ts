import { DeviceError, type DeviceErrorCode, TERMINAL_CODES } from "./protocol";
import type { DeviceClient } from "./rpc";

/** The account the page is signed in as, and whether the server refuses it the sync feed. */
export interface DeviceUser {
	id: string;
	/** Advanced protection is on: its data is sealed, so the device never pulls it. */
	protectedAccount: boolean;
}

export interface ControllerDeps {
	/** A worker, or null when the dev flag is off. */
	load: () => Promise<DeviceClient | null>;
	now: () => number;
	/** The tab is in front: a hidden tab never pulls. */
	visible: () => boolean;
}

export type ControllerState =
	| "off" // nobody signed in
	| "idle" // signed in; no worker yet
	| "running"
	| "terminal"; // the server will not serve this account: nothing retries

/** A wait after a 429 starts here and doubles, up to the cap. */
export const BACKOFF_MS = 60_000;
export const BACKOFF_MAX_MS = 600_000;

/**
 * The page's lifecycle for the device engine: one worker per tab, for one
 * account. It starts only for a signed-in account that is not protected,
 * pulls when Home opens and when the tab comes back to the front (the
 * engine skips a pull when the last one is under a minute old), backs off
 * when the server says slow down, and ends the worker on sign-out or another
 * account. Home keeps the server's numbers throughout: a refusal changes
 * nothing on screen.
 */
export function createDeviceController(deps: ControllerDeps) {
	let user: DeviceUser | null = null;
	let state: ControllerState = "off";
	let client: DeviceClient | null = null;
	/** Bumped when the account changes, so an answer for the old one is dropped. */
	let epoch = 0;
	let homeOpen = false;
	let inflight: Promise<void> | null = null;
	let waitUntil = 0;
	let rateLimits = 0;

	function endWorker() {
		const old = client;
		client = null;
		if (old && !old.dead) {
			void old.stop().catch(() => undefined);
			old.terminate();
		}
	}

	function backOff(code: DeviceErrorCode | "failed") {
		const wait =
			code === "rate_limited"
				? Math.min(BACKOFF_MS * 2 ** rateLimits++, BACKOFF_MAX_MS)
				: BACKOFF_MS;
		waitUntil = deps.now() + wait;
	}

	async function ensureClient(mine: number): Promise<DeviceClient | null> {
		if (client && !client.dead) return client;
		client = null;
		const spawned = await deps.load();
		if (!spawned) return null;
		if (mine !== epoch || !user) {
			spawned.terminate();
			return null;
		}
		try {
			await spawned.start(user.id);
		} catch {
			spawned.terminate();
			backOff("failed");
			return null;
		}
		if (mine !== epoch) {
			spawned.terminate();
			return null;
		}
		client = spawned;
		state = "running";
		return spawned;
	}

	async function run(spawn: boolean): Promise<void> {
		const mine = epoch;
		if (!user || state === "terminal" || !deps.visible()) return;
		if (deps.now() < waitUntil) return;
		if (!client && !spawn) return;
		const worker = await ensureClient(mine);
		if (!worker) return;
		try {
			const { status } = await worker.pull();
			if (mine !== epoch) return;
			if (status === "failed") backOff("failed");
			else rateLimits = 0;
		} catch (error) {
			if (mine !== epoch) return;
			const code = error instanceof DeviceError ? error.code : "unavailable";
			if (TERMINAL_CODES.includes(code)) {
				state = "terminal";
				endWorker();
			} else if (code === "worker_dead") {
				client = null;
				backOff("failed");
			} else backOff(code === "rate_limited" ? code : "failed");
		}
	}

	function pull(spawn: boolean): Promise<void> {
		// One run at a time. A request that must start the worker waits for a
		// run that would not have, then runs.
		if (inflight && !(spawn && !client)) return inflight;
		const run1 = (inflight ?? Promise.resolve()).then(() => run(spawn));
		const mine = run1.finally(() => {
			if (inflight === mine) inflight = null;
		});
		inflight = mine;
		return mine;
	}

	return {
		get state() {
			return state;
		},
		/** The worker once it has started; PR4's parity reads through it. */
		get client() {
			return client && !client.dead ? client : null;
		},
		/** The signed-in account, or null on sign-out. A different account ends the worker. */
		setUser(next: DeviceUser | null) {
			if (
				next?.id === user?.id &&
				next?.protectedAccount === user?.protectedAccount
			)
				return;
			const sameAccount = next !== null && next.id === user?.id;
			user = next;
			if (!sameAccount) {
				epoch += 1;
				endWorker();
				waitUntil = 0;
				rateLimits = 0;
				inflight = null;
			}
			state = !next ? "off" : next.protectedAccount ? "terminal" : "idle";
			if (next?.protectedAccount) endWorker();
			if (state === "idle" && homeOpen) void pull(true);
		},
		/** Home opened: starts the worker if it is not running and pulls when the last pull is old. */
		homeOpened() {
			homeOpen = true;
			return pull(true);
		},
		homeClosed() {
			homeOpen = false;
		},
		/** The tab came to the front: pulls only when a worker already runs (Home was opened). */
		tabVisible() {
			return pull(false);
		},
	};
}

export type DeviceController = ReturnType<typeof createDeviceController>;
