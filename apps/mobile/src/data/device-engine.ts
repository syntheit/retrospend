import type { RetrospendClient } from "@retrospend/api-client";
import type { Money } from "@retrospend/domain/money-minor";
import {
	budgetStatus,
	type Change,
	DEVICE_FIGURE_IDS,
	MemoryStore,
	type PullCursors,
	pullAll,
	readDeviceFigures,
	SETTINGS_ID,
} from "@retrospend/engine";
import { appOpenDeps } from "./engine-db/app-deps";
import { engineScope } from "./engine-db/names";
import type { OpenDeps } from "./engine-db/open";
import {
	type EngineStorage,
	openEngineStorage,
	type StorageHooks,
} from "./engine-db/storage";

// The device engine, behind the dev flag EXPO_PUBLIC_DEV_DEVICE_ENGINE=1: a
// copy of the account's rows in memory, filled by the engine's pull driver
// through the same client every screen uses, and the figures read from those
// rows. The rows and the pull cursors are also kept in an encrypted database
// on the phone (engine-db/), so a launch reads figures from disk at once and
// then pulls only what changed; without one (no key store, no SQLCipher, a
// full disk) the engine is memory-only and every launch pulls everything.
// Only the dev hook (useDeviceEngine.ts) requires this file, and only when the
// flag is set, so a build without it leaves the whole engine out of the
// bundle. scripts/check-release-bundle.sh greps for the name in TAG: it must
// not appear in a release bundle.
const TAG = "RetrospendDeviceEngine";

const warn = (what: string, detail?: string) =>
	console.warn(`${TAG}: ${what}`, detail ?? "");

/** A pull is repeated when the app comes back after this long. */
export const PULL_AFTER_MS = 60_000;

const RESET_REQUIRED = "sync_reset_required";

export type DeviceStatus = "idle" | "pulling" | "ready" | "failed";

/** What the screens may read from the device: figures by id, and a check against the server. */
export interface DeviceReads {
	/**
	 * The device's reading of each id it has a figure for (others are left
	 * out), or null when it holds nothing it can trust: the first pull failed,
	 * or the last one did.
	 */
	read(ids: readonly string[]): Promise<DeviceRead | null>;
	/** Holds the device's readings of `ids` against the server's; never rejects. */
	verify(ids: readonly string[]): Promise<void>;
}

export interface DeviceRead {
	homeCurrency: string;
	/** Whether the budget figures read: a book and a block the pulls caught up with. */
	budgetReady: boolean;
	/** One line per currency, or null when a missing rate keeps the figure out. */
	readings: ReadonlyMap<string, readonly Money[] | null>;
}

export interface ParityResult {
	ids: readonly string[];
	mismatches: { id: string; device: unknown; server: unknown }[];
	/** How many pulls had finished when it was checked. */
	generation: number;
	clock: string;
}

export interface DeviceEngine extends DeviceReads {
	/** "ready" at once when the disk copy holds a whole pull; "idle" until a pull otherwise. */
	readonly status: DeviceStatus;
	/** Pulls that have finished. */
	readonly generation: number;
	/** The last parity check, kept for tests. */
	readonly lastParity: ParityResult | null;
	/** One pull at a time: a call while one runs waits for it. */
	pull(): Promise<void>;
	/** Pulls when none has finished yet or the last one is older than PULL_AFTER_MS. */
	pullIfStale(): Promise<void>;
	/**
	 * Stops the engine: its disk copy takes no more writes and is closed, and
	 * with `wipe` its file and key are deleted. A pull that is still running
	 * fails at its next write, and nothing opens the file again.
	 */
	dispose(options: { wipe: boolean }): Promise<void>;
}

export interface DeviceEngineOptions {
	/** Opens the disk copy; absent or null means memory-only. */
	storage?: (hooks: StorageHooks) => Promise<EngineStorage | null>;
}

const sameLines = (
	device: readonly Money[] | null | undefined,
	server: readonly Money[] | null | undefined,
) =>
	device == null || server == null
		? (device ?? null) === (server ?? null)
		: device.length === server.length &&
			device.every(
				(m, i) =>
					m.minor === server[i]?.minor && m.currency === server[i]?.currency,
			);

export function createDeviceEngine(
	api: RetrospendClient,
	userId: string,
	now: () => number = Date.now,
	options: DeviceEngineOptions = {},
): DeviceEngine {
	let cursors: PullCursors = {};
	let storage: EngineStorage | null = null;
	let status: DeviceStatus = "idle";
	let generation = 0;
	/** Pulls begun, finished or not: a read that spans one is thrown away. */
	let pullsBegun = 0;
	let pulledAt: number | null = null;
	let inflight: Promise<void> | null = null;
	let lastParity: ParityResult | null = null;
	let disposed = false;
	/** Commits the running pull has made: none means the rows are as the pull found them. */
	let commitsInPull = 0;

	const commit = (changes: readonly Change[]) => {
		// A disposed engine takes no more rows, so a pull in flight ends at its next write.
		if (disposed) throw new Error("The engine was disposed");
		commitsInPull += 1;
		storage?.persistence.commit(changes);
	};
	let store = new MemoryStore({ onCommit: commit });

	const hooks: StorageHooks = {
		cursors: () => cursors,
		onDegraded: (cause) => {
			warn("disk copy given up", cause);
			const given = storage;
			storage = null;
			given?.dispose({ wipe: true }).catch(() => undefined);
		},
	};

	/** Opens the disk copy and starts the store from it; memory-only when there is none. */
	async function attach(): Promise<void> {
		store = new MemoryStore({ onCommit: commit });
		cursors = {};
		if (!options.storage) return;
		let opened: EngineStorage | null = null;
		try {
			opened = await options.storage(hooks);
			if (opened === null) return;
			if (disposed) return await opened.dispose({ wipe: true });
			store = new MemoryStore({
				rows: opened.loaded.rows,
				onCommit: commit,
			});
			cursors = opened.loaded.cursors;
			storage = opened;
			// Rows a pull ran to the end of are a whole copy: figures read from
			// them before any network.
			if (opened.loaded.complete) status = "ready";
		} catch (error) {
			// Rows the store would not take: the file is wiped and the engine
			// starts empty in memory.
			warn("disk copy unusable", (error as Error)?.name);
			store = new MemoryStore({ onCommit: commit });
			cursors = {};
			storage = null;
			await opened?.dispose({ wipe: true }).catch(() => undefined);
		}
	}

	/** The newest open of the disk copy, so a dispose waits for it and wipes what it made. */
	let opening = attach();
	/** The first open: nothing reads or pulls before the disk copy has been loaded. */
	const ready = opening;

	/** The server can no longer honor a cursor: nothing pulled with it can be trusted. */
	async function startOver(): Promise<void> {
		const old = storage;
		storage = null;
		await old?.dispose({ wipe: true });
		if (disposed) throw new Error("The engine was disposed");
		opening = attach();
		await opening;
		if (disposed) throw new Error("The engine was disposed");
	}

	async function run(): Promise<void> {
		await ready;
		if (disposed) return;
		pullsBegun += 1;
		const before = status;
		status = "pulling";
		commitsInPull = 0;
		storage?.persistence.beginPull();
		try {
			try {
				await pullAll(store, api, cursors);
			} catch (error) {
				if ((error as { code?: string } | null)?.code !== RESET_REQUIRED)
					throw error;
				await startOver();
				storage?.persistence.beginPull();
				await pullAll(store, api, cursors);
			}
			storage?.persistence.finishPull();
			generation += 1;
			pulledAt = now();
			status = "ready";
		} catch (error) {
			storage?.persistence.abandonPull();
			// A pull that stopped before its first write (offline) left the rows
			// as they were; one that stopped after it may have left them half
			// updated, so nothing reads them until a pull succeeds.
			status = before === "ready" && commitsInPull === 0 ? "ready" : "failed";
			warn("pull failed", (error as Error)?.name);
		}
	}

	const pull = () => {
		inflight ??= run().finally(() => {
			inflight = null;
		});
		return inflight;
	};

	const pullIfStale = () =>
		inflight ??
		(pulledAt === null || now() - pulledAt >= PULL_AFTER_MS
			? pull()
			: Promise.resolve());

	/** The disk copy is loaded and the first pull, or the one in flight, is done: a read never sees a half-pulled store. */
	async function settled(): Promise<void> {
		await ready;
		if (inflight) await inflight;
		else if (status === "idle") await pull();
	}

	async function dispose({ wipe }: { wipe: boolean }): Promise<void> {
		disposed = true;
		// Closing first makes a pull in flight fail at its next write instead of
		// writing to a file that is about to go.
		const closing = storage;
		storage = null;
		closing?.persistence.close();
		await opening.catch(() => undefined);
		// An open that finished after `disposed` was set has already wiped what it made.
		await closing?.dispose({ wipe });
	}

	async function readNow(ids: readonly string[]): Promise<DeviceRead | null> {
		const settings = store.get("settings", SETTINGS_ID);
		if (status !== "ready" || !settings) return null;
		const known = ids.filter((id) => DEVICE_FIGURE_IDS.includes(id));
		const begun = pullsBegun;
		const { readings } = await readDeviceFigures(store, userId, known);
		// A pull that began while the figures were read changed the rows under
		// them (or swapped the store): the reading is of no moment, so Home keeps
		// the server's value.
		if (pullsBegun !== begun || status !== "ready") return null;
		return {
			homeCurrency: settings.homeCurrency,
			budgetReady: budgetStatus(store) === "ready",
			readings,
		};
	}

	async function read(ids: readonly string[]): Promise<DeviceRead | null> {
		await settled();
		try {
			return await readNow(ids);
		} catch (error) {
			warn("read failed", (error as Error)?.name);
			return null;
		}
	}

	async function verify(ids: readonly string[]): Promise<void> {
		try {
			await ready;
			const { figures } = await api.figures.read({ ids: ids.join(",") });
			const differing = async () => {
				const device = await readNow(ids);
				return ids
					.filter((id) => {
						const server = figures.find((f) => f.id === id)?.lines;
						return !sameLines(device?.readings.get(id), server);
					})
					.map((id) => ({
						id,
						device: device?.readings.get(id) ?? null,
						server: figures.find((f) => f.id === id)?.lines ?? null,
					}));
			};
			let mismatches = await differing();
			if (mismatches.length > 0) {
				// A write since the last pull looks the same as a bug: pull once more.
				await pull();
				mismatches = await differing();
			}
			lastParity = {
				ids,
				mismatches,
				generation,
				clock: new Date(now()).toISOString(),
			};
			// Ids and counts only: the amounts stay in lastParity, never in a log.
			if (mismatches.length > 0)
				warn(
					"figures differ from the server",
					JSON.stringify({
						ids: mismatches.map((m) => m.id),
						count: mismatches.length,
						generation: lastParity.generation,
						clock: lastParity.clock,
					}),
				);
		} catch (error) {
			warn("check failed", (error as Error)?.name);
		}
	}

	return {
		get status() {
			return status;
		},
		get generation() {
			return generation;
		},
		get lastParity() {
			return lastParity;
		},
		pull,
		pullIfStale,
		read,
		verify,
		dispose,
	};
}

const engines = new WeakMap<
	RetrospendClient,
	{ userId: string; engine: DeviceEngine }
>();

/**
 * The one engine of a client, account and server. A client outlives a sign
 * out, so a different account on it gets an engine of its own, never the old
 * rows, and the old one is disposed with its file and key. `origin` null
 * (no server connected) means memory-only.
 */
export function engineFor(
	api: RetrospendClient,
	userId: string,
	origin: string | null = null,
	deps: OpenDeps = appOpenDeps(warn),
): DeviceEngine {
	const held = engines.get(api);
	if (held?.userId === userId) return held.engine;
	void held?.engine.dispose({ wipe: true });
	const engine = createDeviceEngine(api, userId, Date.now, {
		storage: origin
			? (hooks) => openEngineStorage(deps, engineScope(origin, userId), hooks)
			: undefined,
	});
	engines.set(api, { userId, engine });
	return engine;
}
