import type { Money } from "@retrospend/domain/money-minor";
import { expense, fakeDeviceApi } from "@retrospend/engine/device-fake";
import { afterEach, beforeEach, expect, vi } from "vitest";
import {
	attachHost,
	type HostApi,
	type HostDeps,
	type HostScope,
} from "../host";
import { DeviceError } from "../protocol";
import { createDeviceClient, type WorkerLike } from "../rpc";

// The worker's host and the page's client over a real MessageChannel: the
// port on one side stands in for the worker's global scope, the other for
// the Worker object. Same engine, same structured clone, no browser.
//
// The server double holds the rows of the engine's own tests (ARS, Buenos
// Aires, "now" 2026-10-15 15:00 UTC): e1 1,000 on Oct 5, e2 2,000 on Sep 10,
// e3 500 on Sep 20. Spent this month is 1,000.00 = 100,000 minor; spent last
// month is 2,500.00 = 250,000 minor.
export const NOW = Date.parse("2026-10-15T15:00:00.000Z");
export const ROWS = [
	expense("e1", "1000", "2026-10-05T15:00:00.000Z"),
	expense("e2", "2000", "2026-09-10T15:00:00.000Z"),
	expense("e3", "500", "2026-09-20T15:00:00.000Z"),
];
export const ARS = (minor: number): Money[] => [{ minor, currency: "ARS" }];

/** The zone the engine double's settings carry unless a test sets one. */
export const STORED_ZONE = "America/Argentina/Buenos_Aires";

const ports: MessagePort[] = [];

/** Fakes only the date ("this month" reads from it); the channel needs real timers. */
export function fakeClock(now: number) {
	beforeEach(() => {
		vi.useFakeTimers({ now, toFake: ["Date"] });
	});
	afterEach(() => {
		vi.useRealTimers();
		for (const port of ports.splice(0)) port.close();
	});
}

export interface SetupOptions {
	rows?: unknown[];
	now?: number;
	/** What the device's own api answers when asked for figures (no network). */
	figures?: Record<string, Money[]>;
	/**
	 * The server's answer to GET /figures, by the zone it reads days in. The
	 * real route reads in the user's stored zone, whatever zone the request
	 * names (no header or cookie is read), so this is called with that zone.
	 */
	serverFigures?: (storedZone: string) => Record<string, Money[]>;
	/** The zone in the settings the engine pulls; the double's own (Buenos Aires) by default. */
	zone?: string;
	/** A route that fails: its name, and in which pull (from 1). */
	fail?: { route: string; pull: number; error: unknown };
	createApi?: (fetch: typeof globalThis.fetch) => HostApi;
	deps?: Partial<HostDeps>;
}

export const urlOf = (input: unknown) =>
	typeof input === "string"
		? input
		: input instanceof URL
			? input.href
			: (input as Request).url;

export function setup(options: SetupOptions = {}) {
	const { port1, port2 } = new MessageChannel();
	ports.push(port1, port2);
	const now = options.now ?? NOW;
	const server = fakeDeviceApi({
		expenses: [
			{
				items: options.rows ?? ROWS,
				tombstones: [],
				cursor: "c1",
				hasMore: false,
			},
		],
		figures: options.figures ?? { "glance.spent": ARS(100_000) },
		fail: options.fail,
	});
	// What the server answers the sync routes, whose cookie the browser holds,
	// and hooks a test uses to act at a moment of a call.
	const answer = { status: 200 };
	const cookie = { userId: "u1" };
	const hooks: {
		status?: (url: string) => Promise<number | undefined>;
		afterSettings?: () => void;
	} = {};
	const fetched = vi.fn(async (input: RequestInfo | URL) => {
		const url = urlOf(input);
		const forced = await hooks.status?.(url);
		const status = forced ?? (url.includes("/profile") ? 200 : answer.status);
		if (url.includes("/figures") && status === 200 && options.serverFigures) {
			return Response.json({
				figures: Object.entries(
					options.serverFigures(options.zone ?? STORED_ZONE),
				).map(([id, lines]) => ({ id, lines })),
			});
		}
		const body =
			status === 403
				? { code: "protected_account", status: 403 }
				: { code: "x", status };
		return new Response(JSON.stringify(body), { status });
	});
	// Routes that ask the server first, as the real client does, and fail the
	// way the client does: an error whose text names an amount.
	const through = (fetch: typeof globalThis.fetch): HostApi => ({
		...server.api,
		profile: {
			get: async () => {
				await fetch("https://example.test/api/v1/profile");
				return { id: cookie.userId };
			},
		},
		figures: {
			read: async (query) => {
				const response = await fetch(
					`https://example.test/api/v1/figures?ids=${query.ids}`,
				);
				if (!response.ok) throw new Error("HTTP failure for 1234.56 ARS");
				return options.serverFigures
					? ((await response.json()) as Awaited<
							ReturnType<HostApi["figures"]["read"]>
						>)
					: server.api.figures.read(query);
			},
		},
		sync: new Proxy(server.api.sync, {
			get: (sync, name, receiver) =>
				name === "settings"
					? async () => {
							const response = await fetch(
								"https://example.test/api/v1/sync/settings",
							);
							hooks.afterSettings?.();
							if (!response.ok) throw new Error("HTTP failure for 1234.56 ARS");
							const settings = await sync.settings();
							return options.zone
								? { ...settings, timeZone: options.zone }
								: settings;
						}
					: Reflect.get(sync, name, receiver),
		}),
	});
	const warn = vi.fn<(what: string, detail?: string) => void>();
	attachHost(port1 as unknown as HostScope, {
		createApi: options.createApi ?? through,
		fetch: fetched as unknown as typeof globalThis.fetch,
		warn,
		now: () => now,
		...options.deps,
	});
	const terminate = vi.fn(() => port2.close());
	const worker: WorkerLike = {
		postMessage: (m) => port2.postMessage(m),
		get onmessage() {
			return port2.onmessage as WorkerLike["onmessage"];
		},
		set onmessage(handler) {
			port2.onmessage = handler as MessagePort["onmessage"];
		},
		onerror: null,
		onmessageerror: null,
		terminate,
	};
	return {
		client: createDeviceClient(worker),
		worker,
		answer,
		cookie,
		hooks,
		fetched,
		warn,
		server,
		terminate,
		raw: port2,
	};
}

/** A worker that never answers. */
export function silent() {
	const { port1, port2 } = new MessageChannel();
	ports.push(port1, port2);
	const terminate = vi.fn();
	const worker: WorkerLike = {
		postMessage: (m) => port2.postMessage(m),
		onmessage: null,
		onerror: null,
		onmessageerror: null,
		terminate,
	};
	return { worker, terminate, client: createDeviceClient(worker) };
}

export const code = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(DeviceError);
		return (error as DeviceError).code;
	}
	return "resolved";
};
