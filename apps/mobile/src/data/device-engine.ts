import type { RetrospendClient } from "@retrospend/api-client";
import type { Money } from "@retrospend/domain/money-minor";
import {
	budgetStatus,
	DEVICE_FIGURE_IDS,
	MemoryStore,
	type PullCursors,
	pullAll,
	readDeviceFigures,
	SETTINGS_ID,
} from "@retrospend/engine";

// The device engine, behind the dev flag EXPO_PUBLIC_DEV_DEVICE_ENGINE=1: a
// copy of the account's rows in memory, filled by the engine's pull driver
// through the same client every screen uses, and the figures read from those
// rows. Nothing is kept on disk, so every launch pulls again. Only the dev
// hook (useDeviceEngine.ts) requires this file, and only when the flag is set,
// so a build without it leaves the whole engine out of the bundle.
// scripts/check-release-bundle.sh greps for the name in TAG: it must not
// appear in a release bundle.
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
	readonly status: DeviceStatus;
	/** Pulls that have finished. */
	readonly generation: number;
	/** The last parity check, kept for tests. */
	readonly lastParity: ParityResult | null;
	/** One pull at a time: a call while one runs waits for it. */
	pull(): Promise<void>;
	/** Pulls when none has finished yet or the last one is older than PULL_AFTER_MS. */
	pullIfStale(): Promise<void>;
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
): DeviceEngine {
	let store = new MemoryStore();
	let cursors: PullCursors = {};
	let status: DeviceStatus = "idle";
	let generation = 0;
	let pulledAt: number | null = null;
	let inflight: Promise<void> | null = null;
	let lastParity: ParityResult | null = null;

	async function run(): Promise<void> {
		status = "pulling";
		try {
			try {
				await pullAll(store, api, cursors);
			} catch (error) {
				if ((error as { code?: string } | null)?.code !== RESET_REQUIRED)
					throw error;
				// The server can no longer honor a cursor, so rows pulled with it
				// cannot be trusted: start over in a new store.
				store = new MemoryStore();
				cursors = {};
				await pullAll(store, api, cursors);
			}
			generation += 1;
			pulledAt = now();
			status = "ready";
		} catch (error) {
			// Rows may be half updated, so nothing reads them until a pull succeeds.
			status = "failed";
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

	/** The first pull, or the one in flight, is done: a read never sees a half-pulled store. */
	async function settled(): Promise<void> {
		if (inflight) await inflight;
		else if (status === "idle") await pull();
	}

	async function readNow(ids: readonly string[]): Promise<DeviceRead | null> {
		const settings = store.get("settings", SETTINGS_ID);
		if (status !== "ready" || !settings) return null;
		const known = ids.filter((id) => DEVICE_FIGURE_IDS.includes(id));
		const { readings } = await readDeviceFigures(store, userId, known);
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
			if (mismatches.length > 0)
				warn("figures differ from the server", JSON.stringify(lastParity));
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
	};
}

const engines = new WeakMap<
	RetrospendClient,
	{ userId: string; engine: DeviceEngine }
>();

/**
 * The one engine of a client and account. A client outlives a sign out, so a
 * different account on it gets an engine of its own, never the old rows.
 */
export function engineFor(api: RetrospendClient, userId: string): DeviceEngine {
	const held = engines.get(api);
	if (held?.userId === userId) return held.engine;
	const engine = createDeviceEngine(api, userId);
	engines.set(api, { userId, engine });
	return engine;
}
