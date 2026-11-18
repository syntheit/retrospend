import { describe, expect, it, vi } from "vitest";
import type { DeviceErrorCode } from "../protocol";
import { ARS, BASIS, code, fakeClock, NOW, setup, silent } from "./harness";

fakeClock(NOW);

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

	it("compares a screen with the server and sends back ids and counts, never amounts", async () => {
		const { client } = setup({
			figures: { "glance.spent": ARS(100_001) },
			basis: BASIS,
		});
		await client.start("u1");
		const result = await client.compare("settings");
		expect(result).toMatchObject({
			screen: "settings",
			state: "checked",
			differs: ["glance.spent"],
		});
		// The device reads 100,000 and the server says 100,001: neither crosses.
		expect(JSON.stringify(result)).not.toMatch(/10000[01]|minor|ARS/);
	});

	it("matches when the server holds what the device's rows make", async () => {
		const { client } = setup({ basis: BASIS });
		await client.start("u1");
		const result = await client.compare("settings");
		expect(result).toMatchObject({ state: "checked", differs: [] });
		expect(result?.classes["glance.spent"]).toBe("match");
	});

	it("reports a server with no basis as skipped, never as a match", async () => {
		const { client } = setup();
		await client.start("u1");
		expect(await client.compare("settings")).toMatchObject({
			state: "skipped",
			skipped: "no_basis",
		});
	});

	it("sends the rendering zone along, as `zone`", async () => {
		const { client } = setup({
			basis: BASIS,
			deps: { browserZone: () => "UTC" },
		});
		await client.start("u1");
		expect((await client.compare("settings"))?.zone).toBe("differs");
	});

	it("refuses a compare for an unknown screen or a malformed narrowing", async () => {
		const { client, raw } = setup({ basis: BASIS });
		await client.start("u1");
		const replies: unknown[] = [];
		raw.addEventListener("message", (e) => replies.push(e.data));
		raw.postMessage({ id: 80, type: "compare", screen: "nope" });
		raw.postMessage({ id: 81, type: "compare", screen: "wealth", values: [1] });
		raw.postMessage({
			id: 82,
			type: "compare",
			screen: "wealth",
			values: { accountId: "a1" },
		});
		await vi.waitFor(() => expect(replies).toHaveLength(3));
		for (const id of [80, 81, 82])
			expect(replies).toContainEqual({ id, ok: false, code: "bad_request" });
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

	it("ends a compare for a protected account with a fixed code, and no later call asks again", async () => {
		const { client, answer, fetched } = setup({ basis: BASIS });
		await client.start("u1");
		answer.status = 403;
		expect(await code(client.compare("home"))).toBe("protected_account");
		const asked = fetched.mock.calls.length;
		expect(await code(client.compare("budget"))).toBe("protected_account");
		expect(await code(client.pull())).toBe("protected_account");
		expect(fetched.mock.calls.length).toBe(asked);
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
		expect(await code(client.compare("settings"))).toBe("account_changed");
		expect(asked().length).toBe(before);
	});

	it("lets two overlapping calls see the same refusal, and none lingers afterwards", async () => {
		const { client, answer } = setup();
		await client.start("u1");
		answer.status = 403;
		const codes = await Promise.all([
			code(client.pull()),
			code(client.read(["glance.spent"])),
			code(client.compare("settings")),
		]);
		expect(codes).toEqual(Array(3).fill("protected_account"));
		await client.stop();
		answer.status = 200;
		await client.start("u1");
		expect((await client.pull()).status).toBe("ready");
		expect((await client.read(["glance.spent"]))?.readings.size).toBe(1);
	});

	it("gives a 429 to every call that overlapped it, not only the first to finish", async () => {
		const { client, hooks } = setup();
		await client.start("u1");
		// Both calls' requests wait until each has been made, then both are limited.
		let waiting = 0;
		let release: () => void = () => undefined;
		const both = new Promise<void>((resolve) => (release = resolve));
		hooks.status = async (url) => {
			if (url.includes("/profile")) return undefined;
			waiting += 1;
			if (waiting === 2) release();
			await both;
			return 429;
		};
		const codes = await Promise.all([
			code(client.pull()),
			code(client.compare("settings")),
		]);
		expect(codes).toEqual(["rate_limited", "rate_limited"]);
		// A wait, not an end: the next call goes through once the server allows it.
		hooks.status = undefined;
		expect((await client.pull()).status).toBe("ready");
	});

	it("wipes the engine when the cookie changed during a pull, before anything reads it", async () => {
		const { client, cookie, hooks } = setup();
		await client.start("u1");
		// Another tab signs in as u2 while this pull is in flight.
		hooks.afterSettings = () => {
			cookie.userId = "u2";
		};
		expect(await code(client.pull())).toBe("account_changed");
		hooks.afterSettings = undefined;
		cookie.userId = "u1";
		// Ended for good: not even the right cookie reads what the pull fetched.
		expect(await code(client.read(["glance.spent"]))).toBe("account_changed");
	});

	it("wipes the engine when the cookie changed during a pull that then failed half way", async () => {
		const { client, cookie, hooks } = setup({
			fail: { route: "expenses", pull: 1, error: new Error("offline") },
		});
		await client.start("u1");
		hooks.afterSettings = () => {
			cookie.userId = "u2";
		};
		// The settings came with u2's cookie and the expenses did not: the pull
		// fails with its generation unchanged, and is still checked.
		expect(await code(client.pull())).toBe("account_changed");
		expect(await code(client.read(["glance.spent"]))).toBe("account_changed");
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
		const waiting = code(client.compare("home"));
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
