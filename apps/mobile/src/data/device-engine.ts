import type { RetrospendClient } from "@retrospend/api-client";
import type {
	BookedWrite,
	BulkAnswer,
	BulkBooked,
	BulkOp,
	DeviceApi,
	Rebase,
	ServerPreview,
	WriteOp,
} from "@retrospend/engine/device";
import {
	createDeviceEngine as createCoreEngine,
	type DeviceEngine,
	type DeviceEngineOptions,
	TAG,
} from "@retrospend/engine/device";
import { appOpenDeps } from "./engine-db/app-deps";
import { engineScope } from "./engine-db/names";
import type { OpenDeps } from "./engine-db/open";
import { openEngineStorage } from "./engine-db/storage";
import { registerLiveEngine } from "./engine-db/sweep";
import type { Outbox } from "./outbox";
import { createPendingSource, type OutboxPending } from "./pendingSource";

// The device engine on the phone, behind the dev flag
// EXPO_PUBLIC_DEV_DEVICE_ENGINE=1: the core (@retrospend/engine/device) with
// this app's log and its encrypted database (engine-db/), so a launch reads
// figures from disk at once and then pulls only what changed; without one (no
// key store, no SQLCipher, a full disk) the engine is memory-only and every
// launch pulls everything. Only the dev hook (useDeviceEngine.ts) requires
// this file, and only when the flag is set, so a build without it leaves the
// whole engine out of the bundle. scripts/check-release-bundle.sh greps for
// TAG (defined in the core): it must not appear in a release bundle.
export {
	type DeviceEngine,
	type DeviceEngineOptions,
	type DeviceReads,
	type DeviceStatus,
	PULL_AFTER_MS,
} from "@retrospend/engine/device";

const warn = (what: string, detail?: string) =>
	console.warn(`${TAG}: ${what}`, detail ?? "");

export const createDeviceEngine = (
	api: DeviceApi,
	userId: string,
	now: () => number = Date.now,
	options: DeviceEngineOptions = {},
): DeviceEngine =>
	createCoreEngine(api, userId, now, {
		...options,
		warn: options.warn ?? warn,
	});

const engines = new WeakMap<
	RetrospendClient,
	{
		userId: string;
		outbox: Outbox | undefined;
		engine: DeviceEngine;
		pending: OutboxPending | null;
		unregister: () => void;
	}
>();

/** What a save, an edit and a delete need of the engine of their client. */
export interface DeviceWrites {
	/** What the device booked for `op` and the version it was based on; null when it could not. */
	book(op: WriteOp): Promise<BookedWrite | null>;
	/** Holds the device preview against the server's dry run; never throws, shows nothing. */
	comparePreview(op: WriteOp, server: ServerPreview): Promise<void>;
	/** `DeviceEngine.pullsBegun`: what an ack carries, so a later pull retires the write. */
	pullsBegun(): number;
	/** The pulled row as the body that saves it again, for Try again; null when it cannot be read. */
	storedRebase(id: string): Promise<Rebase | null>;
	/** A pull that began after pull `pull` finished without this expense (see DeviceEngine). */
	absentSince(id: string, pull: number): Promise<boolean>;
	/** Reads the outbox lists again, after a change the engine should see. */
	refresh(): Promise<void>;
}

/** What a bulk categorize or delete needs of the engine of its client. */
export interface DeviceBulkWrites {
	/** What the device books for a bulk categorize or delete; null when it could not. */
	bookBulk(op: BulkOp): Promise<BulkBooked | null>;
	/** `comparePreview` for a bulk action. */
	comparePreviewBulk(op: BulkOp, server: ServerPreview): Promise<void>;
	/** The server took bulk action `key`: its booking is held against the answer and the next pull. */
	settleBulk(
		key: string,
		booked: BulkBooked,
		answer: BulkAnswer,
		ids: readonly string[],
	): void;
	/** Bulk action `key` was undone: its rows are not compared. */
	undoneBulk(key: string): void;
}

/** The bulk side of the engine of `api`, or null when it has none (or it was disposed). */
export function bulkWritesFor(api: RetrospendClient): DeviceBulkWrites | null {
	const held = engines.get(api);
	if (!held || held.engine.disposed) return null;
	const { engine } = held;
	return {
		bookBulk: (op) => engine.bookBulk(op),
		comparePreviewBulk: async (op, server) => {
			await engine.comparePreviewBulk(op, server);
		},
		settleBulk: (key, booked, answer, ids) =>
			engine.settleBulk(key, booked, answer, ids),
		undoneBulk: (key) => engine.undoneBulk(key),
	};
}

/** The write side of the engine of `api`, or null when it has none (or it was disposed). */
export function writesFor(api: RetrospendClient): DeviceWrites | null {
	const held = engines.get(api);
	if (!held || held.engine.disposed) return null;
	const { engine, pending } = held;
	return {
		book: (op) => engine.book(op),
		comparePreview: async (op, server) => {
			await engine.comparePreview(op, server);
		},
		pullsBegun: () => engine.pullsBegun,
		storedRebase: (id) => engine.storedRebase(id),
		absentSince: (id, pull) => engine.absentSince(id, pull),
		refresh: () => pending?.refresh() ?? Promise.resolve(),
	};
}

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
	outbox?: Outbox,
): DeviceEngine {
	const held = engines.get(api);
	if (
		held?.userId === userId &&
		held.outbox === outbox &&
		!held.engine.disposed
	)
		return held.engine;
	held?.unregister();
	void held?.engine.dispose({ wipe: true });
	const scope = origin ? engineScope(origin, userId) : null;
	// The engine reads the phone's unsent and acked writes through the outbox.
	const pending = outbox ? createPendingSource(outbox) : null;
	void pending?.refresh().catch(() => undefined);
	const engine = createDeviceEngine(api, userId, Date.now, {
		...(pending ? { pending } : {}),
		storage: scope
			? (hooks) => openEngineStorage(deps, scope, hooks)
			: undefined,
	});
	const unregister = scope
		? registerLiveEngine(scope, () => engine.dispose({ wipe: true }))
		: () => undefined;
	engines.set(api, { userId, outbox, engine, pending, unregister });
	return engine;
}
