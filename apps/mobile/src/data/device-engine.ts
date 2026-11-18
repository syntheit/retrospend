import type { RetrospendClient } from "@retrospend/api-client";
import type { DeviceApi } from "@retrospend/engine/device";
import {
	CreateCaptures,
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
		engine: DeviceEngine;
		captures: CreateCaptures;
		unregister: () => void;
	}
>();

const CAPTURED = {
	expenses: "expense",
	"shared-expenses": "split",
	transfers: "transfer",
} as const;

/** Forgets the create of `id` the engine of `api` was holding: the row is about to change. */
export function dropCaptured(api: object, id: string): void {
	// Callers may hold the client as a narrower type; the key is the same object.
	engines.get(api as RetrospendClient)?.captures.drop(id);
}

/**
 * Hands the engine of `api` a create the server just accepted, for it to book
 * again and compare after the next pull. Only the entity's family and the
 * body go in; the engine keeps the booking fields and drops the rest.
 */
export function captureSent(
	api: RetrospendClient,
	entry: { clientId: string; entity: string; payload: unknown },
	startedAt: number,
): void {
	const kind = CAPTURED[entry.entity as keyof typeof CAPTURED];
	if (!kind) return;
	engines.get(api)?.captures.add({
		id: entry.clientId,
		kind,
		body: entry.payload,
		at: startedAt,
	});
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
): DeviceEngine {
	const held = engines.get(api);
	if (held?.userId === userId && !held.engine.disposed) return held.engine;
	held?.unregister();
	void held?.engine.dispose({ wipe: true });
	const scope = origin ? engineScope(origin, userId) : null;
	const captures = new CreateCaptures();
	const engine = createDeviceEngine(api, userId, Date.now, {
		storage: scope
			? (hooks) => openEngineStorage(deps, scope, hooks)
			: undefined,
		captures,
	});
	const unregister = scope
		? registerLiveEngine(scope, () => engine.dispose({ wipe: true }))
		: () => undefined;
	engines.set(api, { userId, engine, captures, unregister });
	return engine;
}
