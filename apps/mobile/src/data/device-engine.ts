import type { RetrospendClient } from "@retrospend/api-client";
import type { MonthViewDto } from "@retrospend/domain/envelope/dto";
import type { Money } from "@retrospend/domain/money-minor";
import {
	budgetStatus,
	type Change,
	DEVICE_FIGURE_IDS,
	deviceMonthView,
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
import { registerLiveEngine } from "./engine-db/sweep";

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
	read(
		ids: readonly string[],
		options?: ReadOptions,
	): Promise<DeviceRead | null>;
	/** Holds the device's readings of `ids` against the server's; never rejects. */
	verify(ids: readonly string[]): Promise<void>;
	/**
	 * Records that the device's budget verdict still differed from the server's
	 * after a fresh pull: `parts` names what differed (state, action, figure,
	 * amount) and `values` keeps both sides, never logged.
	 */
	reportVerdict(
		figureId: string,
		parts: readonly string[],
		values: { device: unknown; server: unknown },
	): void;
}

export interface ReadOptions {
	/**
	 * Reads only after a pull that began with this call has finished, so the
	 * rows hold what the server held when it was made (a write just confirmed
	 * shows). Null when that pull fails or the engine cannot pull.
	 */
	fresh?: boolean;
	/** Also reads the current budget month into `budget`. */
	budget?: boolean;
}

/** The current budget month as the device's rows make it: the verdict and what it is a verdict of. */
export interface DeviceBudget {
	bookId: string;
	/** The book's currency, which the verdict's amounts are in (not the home currency). */
	currency: string;
	month: number;
	today: string;
	approximate: boolean;
	incomplete: boolean;
	verdict: MonthViewDto["verdict"];
}

export interface DeviceRead {
	homeCurrency: string;
	/** Whether the budget figures read: a book and a block the pulls caught up with. */
	budgetReady: boolean;
	/** The current month's verdict when asked for with `budget` and the block is readable, else null. */
	budget: DeviceBudget | null;
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
	/** Stopped for good: a new engine is needed to read or pull again. */
	readonly disposed: boolean;
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
	/** What a dispose asked for, for an open that finishes after it. */
	let wipeOnDispose = false;
	/** A reset emptied the store in the running pull: nothing is held until a pull completes. */
	let emptied = false;
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
			if (disposed) return await opened.dispose({ wipe: wipeOnDispose });
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
		emptied = true;
		// The rows earlier commits wrote are gone with the old store.
		commitsInPull = 0;
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
		emptied = false;
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
			// After a reset with no write since, the store holds nothing: idle, so
			// the next read pulls again.
			if (commitsInPull === 0 && emptied) status = "idle";
			else
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
		wipeOnDispose ||= wipe;
		// Closing first makes a pull in flight fail at its next write instead of
		// writing to a file that is about to go.
		const closing = storage;
		storage = null;
		closing?.persistence.close();
		await opening.catch(() => undefined);
		// An open that finished after `disposed` was set has already wiped what it made.
		await closing?.dispose({ wipe });
	}

	async function budgetNow(): Promise<DeviceBudget | null> {
		try {
			const dto = await deviceMonthView(store, userId, () => new Date(now()));
			if (!dto) return null;
			return {
				bookId: dto.book.id,
				currency: dto.book.currency,
				month: dto.month.key,
				today: dto.today,
				approximate: dto.approximate,
				incomplete: dto.incomplete,
				verdict: dto.verdict,
			};
		} catch (error) {
			// Only the budget is lost: the figures of the same read stand.
			warn("budget read failed", (error as Error)?.name);
			return null;
		}
	}

	async function readNow(
		ids: readonly string[],
		withBudget = false,
	): Promise<DeviceRead | null> {
		const settings = store.get("settings", SETTINGS_ID);
		if (status !== "ready" || !settings) return null;
		const known = ids.filter((id) => DEVICE_FIGURE_IDS.includes(id));
		const begun = pullsBegun;
		const { readings } = await readDeviceFigures(store, userId, known);
		const budgetReady = budgetStatus(store) === "ready";
		const budget = withBudget && budgetReady ? await budgetNow() : null;
		// A pull that began while the figures were read changed the rows under
		// them (or swapped the store): the reading is of no moment, so Home keeps
		// the server's value.
		if (pullsBegun !== begun || status !== "ready") return null;
		return {
			homeCurrency: settings.homeCurrency,
			budgetReady,
			budget,
			readings,
		};
	}

	/** Whether a pull that began after this call has finished. */
	async function pulledAfterNow(): Promise<boolean> {
		await ready;
		// A pull already running began before the call, so its rows may be older
		// than a write the caller just saw confirmed: wait it out, then pull.
		if (inflight) await inflight;
		const before = generation;
		await pull();
		return generation > before;
	}

	async function read(
		ids: readonly string[],
		options: ReadOptions = {},
	): Promise<DeviceRead | null> {
		if (options.fresh) {
			if (!(await pulledAfterNow())) return null;
		} else await settled();
		try {
			return await readNow(ids, options.budget);
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

	function reportVerdict(
		figureId: string,
		parts: readonly string[],
		values: { device: unknown; server: unknown },
	): void {
		lastParity = {
			ids: [figureId],
			mismatches: [{ id: figureId, ...values }],
			generation,
			clock: new Date(now()).toISOString(),
		};
		// Ids and parts only: the amounts stay in lastParity, never in a log.
		warn(
			"budget verdict differs from the server",
			JSON.stringify({
				ids: [figureId],
				parts,
				generation: lastParity.generation,
				clock: lastParity.clock,
			}),
		);
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
		get disposed() {
			return disposed;
		},
		pull,
		pullIfStale,
		read,
		verify,
		reportVerdict,
		dispose,
	};
}

const engines = new WeakMap<
	RetrospendClient,
	{ userId: string; engine: DeviceEngine; unregister: () => void }
>();

/**
 * The one engine of a client, account and server. A client outlives a sign
 * out, so a different account on it gets an engine of its own, never the old
 * rows, and the old one is disposed with its file and key; so is one the
 * sweep has stopped, which a new sign-in replaces. `origin` null (no server
 * connected) means memory-only.
 */
export function engineFor(
	api: RetrospendClient,
	userId: string,
	origin: string | null = null,
	deps: OpenDeps = appOpenDeps(warn),
): DeviceEngine {
	const held = engines.get(api);
	if (held?.userId === userId && !held.engine.disposed) return held.engine;
	held?.unregister();
	void held?.engine.dispose({ wipe: true });
	const scope = origin ? engineScope(origin, userId) : null;
	const engine = createDeviceEngine(api, userId, Date.now, {
		storage: scope
			? (hooks) => openEngineStorage(deps, scope, hooks)
			: undefined,
	});
	const unregister = scope
		? registerLiveEngine(scope, () => engine.dispose({ wipe: true }))
		: () => undefined;
	engines.set(api, { userId, engine, unregister });
	return engine;
}
