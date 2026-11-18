import type { CompareReport, ScreenName } from "@retrospend/engine/device";
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
	/** The pull count the last compare ended at: a pull that changed nothing is not checked again. */
	let checkedGeneration = 0;
	/** The last report of each screen that has been compared. */
	let reports: Partial<Record<ScreenName, CompareReport>> = {};
	let lastPullAt: number | null = null;
	/** The pull count at the last real pull: a pull the engine skipped as fresh leaves it. */
	let pulledGeneration = 0;
	const listeners = new Set<() => void>();
	const changed = () => {
		for (const listener of [...listeners]) listener();
	};

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

	/** The worker being made for one account, shared so no two runs make one each. */
	let spawning: { epoch: number; worker: Promise<DeviceClient | null> } | null =
		null;

	async function spawn(mine: number): Promise<DeviceClient | null> {
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
			// A late failure for an account that has gone must not delay the new one.
			if (mine === epoch) backOff("failed");
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

	function ensureClient(mine: number): Promise<DeviceClient | null> {
		if (client && !client.dead) return Promise.resolve(client);
		client = null;
		if (spawning?.epoch !== mine) {
			const worker = spawn(mine).finally(() => {
				if (spawning?.worker === worker) spawning = null;
			});
			spawning = { epoch: mine, worker };
		}
		return spawning.worker;
	}

	async function run(spawn: boolean, force: boolean): Promise<void> {
		const mine = epoch;
		if (!user || state === "terminal" || !deps.visible()) return;
		// An explicit check goes past a wait: it is a person asking.
		if (!force && deps.now() < waitUntil) return;
		if (!client && !spawn) return;
		const worker = await ensureClient(mine);
		if (!worker) return;
		try {
			const { status, generation } = await worker.pull();
			if (mine !== epoch) return;
			if (status === "failed") backOff("failed");
			else {
				if (generation > pulledGeneration) {
					pulledGeneration = generation;
					lastPullAt = deps.now();
				}
				// Compare only: the figures are checked against the server's and the
				// screen keeps showing the server's. The engine pulls for it too.
				if (status === "ready" && (force || generation > checkedGeneration)) {
					const report = await worker.compare("home");
					if (mine !== epoch) return;
					// A check that could not run is tried again, after a wait.
					if (!report) return backOff("failed");
					reports = { ...reports, [report.screen]: report };
					changed();
					checkedGeneration = report.generation;
				}
				// Only a whole run, check included, ends a run of 429s.
				rateLimits = 0;
			}
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

	function pull(spawn: boolean, force = false): Promise<void> {
		// One run at a time. A request that must start the worker waits for a
		// run that would not have, then runs.
		if (inflight && !force && !(spawn && !client)) return inflight;
		// Starts at once when nothing runs: a run deferred to a microtask would
		// see an account set meanwhile and start a second worker beside the one
		// that account's own pull starts.
		const run1 = inflight
			? inflight.then(() => run(spawn, force))
			: run(spawn, force);
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
		/** The worker once it has started. */
		get client() {
			return client && !client.dead ? client : null;
		},
		/** The last report of each screen compared, for a dev readout. */
		get reports() {
			return reports;
		},
		/** When the last pull finished (the controller's clock), or null before one. */
		get lastPullAt() {
			return lastPullAt;
		},
		/** Runs for any change a readout shows; returns what stops it. */
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		/** Pulls if due and compares Home now, past any wait, whether or not a pull finished since the last check. */
		checkNow() {
			return pull(true, true);
		},
		/** The signed-in account, or null on sign-out. A different account ends the worker. */
		setUser(next: DeviceUser | null) {
			if (
				next?.id === user?.id &&
				next?.protectedAccount === user?.protectedAccount
			)
				return;
			user = next;
			// Any change (another account, or protection turned on for this one)
			// drops what a run in flight is doing: its answer is for the old state.
			epoch += 1;
			endWorker();
			waitUntil = 0;
			rateLimits = 0;
			inflight = null;
			spawning = null;
			checkedGeneration = 0;
			pulledGeneration = 0;
			lastPullAt = null;
			reports = {};
			state = !next ? "off" : next.protectedAccount ? "terminal" : "idle";
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
		/**
		 * The tab came to the front: pulls when a worker runs, and starts one when
		 * Home is open (it was opened in a hidden tab, which never pulls).
		 */
		tabVisible() {
			return pull(homeOpen);
		},
	};
}

export type DeviceController = ReturnType<typeof createDeviceController>;
