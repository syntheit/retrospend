import { expense, fakeDeviceApi } from "@retrospend/engine/device-fake";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachHost, type HostApi, type HostScope } from "../host";
import { DeviceError, type DeviceErrorCode } from "../protocol";
import { createDeviceClient, type WorkerLike } from "../rpc";

// The worker's host and the page's client over a real MessageChannel: the
// port on one side stands in for the worker's global scope, the other for
// the Worker object. Same engine, same structured clone, no browser.
//
// The server double holds the rows of the engine's own tests (ARS, Buenos
// Aires, "now" 2026-10-15 15:00 UTC): e1 1,000 on Oct 5, e2 2,000 on Sep 10,
// e3 500 on Sep 20. Spent this month is 1,000.00 = 100,000 minor; spent last
// month is 2,500.00 = 250,000 minor.
const NOW = Date.parse("2026-10-15T15:00:00.000Z");
const ROWS = [
	expense("e1", "1000", "2026-10-05T15:00:00.000Z"),
	expense("e2", "2000", "2026-09-10T15:00:00.000Z"),
	expense("e3", "500", "2026-09-20T15:00:00.000Z"),
];
const page = { items: ROWS, tombstones: [], cursor: "c1", hasMore: false };
const ARS = (minor: number) => [{ minor, currency: "ARS" }];

const ports: MessagePort[] = [];
beforeEach(() => {
	// Only the date: the figures read "this month" from it, and the channel needs real timers.
	vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});
afterEach(() => {
	vi.useRealTimers();
	for (const port of ports.splice(0)) port.close();
});

function setup(
	options: {
		figures?: Record<string, { minor: number; currency: string }[]>;
		createApi?: (fetch: typeof globalThis.fetch) => HostApi;
	} = {},
) {
	const { port1, port2 } = new MessageChannel();
	ports.push(port1, port2);
	const server = fakeDeviceApi({
		expenses: [page],
		figures: options.figures ?? { "glance.spent": ARS(100_000) },
	});
	// What the server answers the sync routes, and whose cookie the browser holds.
	const answer = { status: 200 };
	const cookie = { userId: "u1" };
	const fetched = vi.fn(async (input: unknown) => {
		const status = String(input).includes("/profile") ? 200 : answer.status;
		const body =
			status === 403
				? { code: "protected_account", status: 403 }
				: { code: "x", status };
		return new Response(JSON.stringify(body), { status });
	});
	// A route that asks the server first, as the real client does, and fails
	// the way the client does: an error whose text names an amount.
	const through = (fetch: typeof globalThis.fetch): HostApi => ({
		...server.api,
		profile: {
			get: async () => {
				await fetch("https://example.test/api/v1/profile");
				return { id: cookie.userId };
			},
		},
		sync: new Proxy(server.api.sync, {
			get: (sync, name, receiver) =>
				name === "settings"
					? async () => {
							const response = await fetch(
								"https://example.test/api/v1/sync/settings",
							);
							if (!response.ok) throw new Error("HTTP failure for 1234.56 ARS");
							return sync.settings();
						}
					: Reflect.get(sync, name, receiver),
		}),
	});
	attachHost(port1 as unknown as HostScope, {
		createApi: options.createApi ?? through,
		fetch: fetched as unknown as typeof globalThis.fetch,
		warn: () => undefined,
		now: () => NOW,
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
		fetched,
		server,
		terminate,
		raw: port2,
	};
}

const code = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(DeviceError);
		return (error as DeviceError).code;
	}
	return "resolved";
};

describe("worker host over a message channel", () => {
	it("starts, pulls and reads the device's figure", async () => {
		const { client } = setup();
		await client.start("u1");
		const pulled = await client.pull();
		expect(pulled).toEqual({ status: "ready", generation: 1 });
		const read = await client.read(["glance.spent"]);
		expect(read?.homeCurrency).toBe("ARS");
		expect(read?.readings.get("glance.spent")).toEqual(ARS(100_000));
	});

	it("pairs every answer with its request when calls overlap", async () => {
		const { client } = setup({
			figures: {
				"glance.spent": ARS(100_000),
				"glance.spentLast": ARS(250_000),
			},
		});
		await client.start("u1");
		const [a, b, pulled, c] = await Promise.all([
			client.read(["glance.spent"]),
			client.read(["glance.spentLast"]),
			client.pull(),
			client.read(["glance.spent", "glance.spentLast"]),
		]);
		expect(a?.readings.get("glance.spent")).toEqual(ARS(100_000));
		expect(a?.readings.has("glance.spentLast")).toBe(false);
		expect(b?.readings.get("glance.spentLast")).toEqual(ARS(250_000));
		expect(pulled.generation).toBe(1);
		expect(c?.readings.size).toBe(2);
	});

	it("verifies against the server and sends back ids, never amounts", async () => {
		const { client } = setup({
			figures: {
				"glance.spent": ARS(100_000),
				"glance.spentLast": ARS(260_000),
			},
		});
		await client.start("u1");
		await client.pull();
		const result = await client.verify(["glance.spent", "glance.spentLast"]);
		expect(result?.mismatchedIds).toEqual(["glance.spentLast"]);
		const text = JSON.stringify(result);
		expect(text).not.toMatch(/260000|250000|100000/);
	});

	it("answers a refusal with a fixed code and then refuses without asking again", async () => {
		const { client, answer, fetched } = setup();
		await client.start("u1");
		answer.status = 403;
		expect(await code(client.pull())).toBe("protected_account");
		const asked = fetched.mock.calls.length;
		expect(await code(client.pull())).toBe("protected_account");
		expect(await code(client.read(["glance.spent"]))).toBe("protected_account");
		expect(fetched.mock.calls.length).toBe(asked);
		// Stop clears it: a new start may try again.
		await client.stop();
		answer.status = 200;
		await client.start("u1");
		expect((await client.pull()).status).toBe("ready");
	});

	it("ends the engine when the cookie now belongs to another account, before it pulls", async () => {
		const { client, cookie, fetched } = setup();
		await client.start("u1");
		await client.pull();
		const asked = () =>
			fetched.mock.calls.filter(([url]) => String(url).includes("/sync/"));
		const before = asked().length;
		// Another tab signed out and in as u2: this tab's cookie is theirs now.
		cookie.userId = "u2";
		expect(await code(client.pull())).toBe("account_changed");
		expect(asked().length).toBe(before);
		expect(await code(client.read(["glance.spent"]))).toBe("account_changed");
		expect(await code(client.verify(["glance.spent"]))).toBe("account_changed");
		expect(asked().length).toBe(before);
	});

	it("lets two overlapping calls see the same refusal, and none lingers afterwards", async () => {
		const { client, answer } = setup();
		await client.start("u1");
		answer.status = 403;
		const codes = await Promise.all([
			code(client.pull()),
			code(client.read(["glance.spent"])),
			code(client.verify(["glance.spent"])),
		]);
		expect(codes).toEqual(Array(3).fill("protected_account"));
		await client.stop();
		answer.status = 200;
		await client.start("u1");
		expect((await client.pull()).status).toBe("ready");
		expect((await client.read(["glance.spent"]))?.readings.size).toBe(1);
	});

	it("treats a 401 as terminal and a 429 as a wait", async () => {
		const unauthenticated = setup();
		await unauthenticated.client.start("u1");
		unauthenticated.answer.status = 401;
		expect(await code(unauthenticated.client.pull())).toBe("unauthenticated");
		unauthenticated.answer.status = 200;
		expect(await code(unauthenticated.client.pull())).toBe("unauthenticated");

		const limited = setup();
		await limited.client.start("u1");
		limited.answer.status = 429;
		expect(await code(limited.client.pull())).toBe("rate_limited");
		limited.answer.status = 200;
		expect((await limited.client.pull()).status).toBe("ready");
	});

	it("rejects a call before start and a malformed one", async () => {
		const { client, raw } = setup();
		expect(await code(client.pull())).toBe("not_started");
		await client.start("u1");
		const replies: unknown[] = [];
		raw.addEventListener("message", (e) => replies.push(e.data));
		raw.postMessage({ id: 90, type: "read", ids: "glance.spent" });
		raw.postMessage({ id: 91, type: "nope" });
		await vi.waitFor(() => expect(replies).toHaveLength(2));
		expect(replies).toContainEqual({ id: 90, ok: false, code: "bad_request" });
		expect(replies).toContainEqual({ id: 91, ok: false, code: "bad_request" });
	});

	it("never lets an error's text cross: an unexpected failure is only 'unavailable'", async () => {
		const { client, raw } = setup({
			createApi: () => {
				throw new Error("secret 42.50 ARS for Ana");
			},
		});
		const replies: unknown[] = [];
		raw.addEventListener("message", (e) => replies.push(e.data));
		expect(await code(client.start("u1"))).toBe("unavailable");
		await vi.waitFor(() => expect(replies).toHaveLength(1));
		expect(JSON.stringify(replies)).not.toMatch(/secret|42|Ana/);
	});

	it("keeps the engine's rows in memory: nothing opens a database", async () => {
		const original = globalThis.indexedDB;
		const open = vi.fn();
		Object.defineProperty(globalThis, "indexedDB", {
			value: { open },
			configurable: true,
		});
		try {
			const { client } = setup();
			await client.start("u1");
			await client.pull();
			expect(open).not.toHaveBeenCalled();
		} finally {
			Object.defineProperty(globalThis, "indexedDB", {
				value: original,
				configurable: true,
			});
		}
	});
});

/** A worker that never answers. */
function silent() {
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

describe("device client with a dead worker", () => {
	it("rejects every call that is waiting, ends the worker and refuses new calls", async () => {
		const { client, worker, terminate } = silent();
		const codes = Promise.all([
			code(client.pull()),
			code(client.read(["glance.spent"])),
		]);
		worker.onerror?.({});
		expect(await codes).toEqual<DeviceErrorCode[]>([
			"worker_dead",
			"worker_dead",
		]);
		expect(client.dead).toBe(true);
		expect(terminate).toHaveBeenCalledTimes(1);
		expect(await code(client.pull())).toBe("worker_dead");
	});

	it("treats a message it cannot read as a dead worker", async () => {
		const { client, worker } = silent();
		const waiting = code(client.pull());
		worker.onmessageerror?.({});
		expect(await waiting).toBe("worker_dead");
		expect(client.dead).toBe(true);
	});

	it("rejects a call waiting when the page ends the worker", async () => {
		const { client, terminate } = silent();
		const waiting = code(client.verify(["glance.spent"]));
		client.terminate();
		expect(await waiting).toBe("worker_dead");
		expect(terminate).toHaveBeenCalled();
		expect(await code(client.stop())).toBe("worker_dead");
	});

	it("answers a call that arrives after a late reply for an unknown id by ignoring it", async () => {
		const { client, worker } = silent();
		worker.onmessage?.({ data: { id: 999, ok: true, value: null } });
		expect(client.dead).toBe(false);
	});
});
