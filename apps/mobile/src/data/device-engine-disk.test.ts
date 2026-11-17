import type { DeviceApi } from "@retrospend/engine/device";
import { cipherFake } from "../../test/cipherFake";
import {
	type DeviceApiOptions,
	expense,
	fakeDeviceApi,
} from "../../test/deviceApi";
import { removeDir, tempDir } from "../../test/nodeSqlite";
import { createDeviceEngine, type DeviceEngine } from "./device-engine";
import type { SqlDriver } from "./engine-db/driver";
import { engineFileName, engineKeyName, engineScope } from "./engine-db/names";
import { readIndex } from "./engine-db/secrets";
import { openEngineStorage } from "./engine-db/storage";

// The device engine with its rows on disk. "The phone" is one cipherFake (a
// folder, a keystore and the cipher), "a launch" is a new engine on it, and
// the server is fakeDeviceApi. Expenses (ARS, so no rate is read):
//   e1  1,000 on Oct 5    this month
//   e2  2,000 on Sep 10   last month, before the 15th
//   e3    500 on Sep 20   last month, after the 15th
// at "now" 2026-10-15 12:00 in Buenos Aires: Spent is 1,000.00 (100,000
// minor), Spent last month is 2,500.00 (250,000).

const NOW = new Date("2026-10-15T15:00:00.000Z");
const ORIGIN = "https://money.example.test";
const SCOPE = engineScope(ORIGIN, "u1");
const E1 = expense("e1", "1000", "2026-10-05T15:00:00.000Z");
const E2 = expense("e2", "2000", "2026-09-10T15:00:00.000Z");
const E3 = expense("e3", "500", "2026-09-20T15:00:00.000Z");
const ARS = (minor: number) => [{ minor, currency: "ARS" }];
const SPENT = ["glance.spent", "glance.spentLast"];

let dir: string;
beforeEach(() => {
	jest.useFakeTimers({ now: NOW });
	jest.spyOn(console, "warn").mockImplementation(() => {});
	dir = tempDir();
});
afterEach(() => {
	jest.useRealTimers();
	jest.restoreAllMocks();
	removeDir(dir);
});

type Phone = ReturnType<typeof cipherFake>;

/** A launch of the app on `phone`: an engine whose disk copy is the phone's. */
function launch(phone: Phone, api: DeviceApi, userId = "u1"): DeviceEngine {
	return createDeviceEngine(api, userId, Date.now, {
		storage: (hooks) =>
			openEngineStorage(phone.deps, engineScope(ORIGIN, userId), hooks),
	});
}

/** A server that cannot be reached: every call is recorded and fails. */
function offline() {
	const calls: string[] = [];
	const down = (name: string) => async () => {
		calls.push(name);
		throw new Error("offline");
	};
	const api = {
		sync: new Proxy({}, { get: (_t, name: string) => down(name) }),
		currencies: { dailyRates: down("dailyRates") },
		figures: { read: down("figures") },
	} as unknown as DeviceApi;
	return { api, calls };
}

const served = (
	options: DeviceApiOptions = { expensePages: [page([E1, E2, E3])] },
) => fakeDeviceApi(options);
function page(items: unknown[], cursor = "c1") {
	return { items, cursor };
}
const spent = async (engine: DeviceEngine) =>
	Object.fromEntries((await engine.read(SPENT))?.readings ?? []);

describe("a launch after a whole pull", () => {
	it("reads the figures from disk with no network, then pulls what changed", async () => {
		const phone = cipherFake(dir);
		const first = launch(phone, served().api);
		await first.pull();
		expect(await spent(first)).toEqual({
			"glance.spent": ARS(100_000),
			"glance.spentLast": ARS(250_000),
		});
		await first.dispose({ wipe: false });

		const down = offline();
		const second = launch(phone, down.api);
		expect(await spent(second)).toEqual({
			"glance.spent": ARS(100_000),
			"glance.spentLast": ARS(250_000),
		});
		expect(second.status).toBe("ready");
		expect(down.calls).toEqual([]);

		// Online again: it asks only for what is after the saved cursor.
		const online = served({ expensePages: [page([E1, E2, E3], "c1")] });
		const third = launch(phone, online.api);
		await third.pull();
		expect(online.calls.filter((c) => c.startsWith("expenses"))).toEqual([
			"expenses(c1)",
		]);
	});

	it("keeps the figures when a refresh fails before it writes anything", async () => {
		const phone = cipherFake(dir);
		const first = launch(phone, served().api);
		await first.pull();
		await first.dispose({ wipe: false });

		const second = launch(phone, offline().api);
		await second.pull();
		expect(second.status).toBe("ready");
		expect(second.generation).toBe(0);
		expect((await spent(second))["glance.spent"]).toEqual(ARS(100_000));
	});

	it("reads nothing when a refresh fails after it wrote, not the half-updated figures", async () => {
		const phone = cipherFake(dir);
		const first = launch(phone, served().api);
		await first.pull();
		await first.dispose({ wipe: false });

		// A whole copy on disk. The refresh brings e1 as 9,000.00 in a later page,
		// then the accounts step dies: e1 is updated and the rest is not.
		const second = launch(
			phone,
			served({
				expensePages: [
					page([E1, E2, E3], "c1"),
					page([expense("e1", "9000", "2026-10-05T15:00:00.000Z")], "c2"),
				],
				fail: { route: "accounts", pull: 1, error: new Error("killed") },
			}).api,
		);
		expect(await spent(second)).toEqual({
			"glance.spent": ARS(100_000),
			"glance.spentLast": ARS(250_000),
		});
		expect(second.status).toBe("ready");
		await second.pull();
		expect(second.status).toBe("failed");
		expect(await second.read(SPENT)).toBeNull();
	});

	it("saves the cursors of a pull that changed no expense", async () => {
		const phone = cipherFake(dir);
		const first = launch(
			phone,
			served({ expensePages: [page([E1], "c1")] }).api,
		);
		await first.pull();
		await first.dispose({ wipe: false });

		// The server moved its cursor with nothing new; the next launch must ask from there.
		const quiet = served({ expensePages: [page([], "c7")] });
		const second = launch(phone, quiet.api);
		await second.pull();
		await second.dispose({ wipe: false });

		const third = served();
		await launch(phone, third.api).pull();
		expect(third.calls.filter((c) => c.startsWith("expenses"))).toEqual([
			"expenses(c7)",
		]);
	});

	it("keeps each account's rows to itself", async () => {
		const phone = cipherFake(dir);
		const mine = launch(phone, served().api);
		await mine.pull();
		await mine.dispose({ wipe: false });

		const other = launch(phone, offline().api, "u2");
		expect(await other.read(SPENT)).toBeNull();
		expect(phone.files.size).toBe(2);
	});
});

describe("a launch after a pull that did not finish", () => {
	const killed = async (phone: Phone) => {
		// Two expense pages, then the accounts step dies: the rows of both pages are on disk.
		const crash = served({
			expensePages: [page([E1], "c1"), page([E2, E3], "c2")],
			fail: { route: "accounts", pull: 1, error: new Error("killed") },
		});
		const engine = launch(phone, crash.api);
		await engine.pull();
		expect(engine.status).toBe("failed");
		await engine.dispose({ wipe: false });
	};

	it("reads nothing, even though most rows are there", async () => {
		const phone = cipherFake(dir);
		await killed(phone);
		const down = offline();
		const second = launch(phone, down.api);
		expect(await second.read(SPENT)).toBeNull();
		expect(second.status).toBe("failed");
	});

	it("resumes from the saved cursors and finishes the copy", async () => {
		const phone = cipherFake(dir);
		await killed(phone);
		const online = served({
			expensePages: [page([E1], "c1"), page([E2, E3], "c2")],
		});
		const second = launch(phone, online.api);
		expect(await spent(second)).toEqual({
			"glance.spent": ARS(100_000),
			"glance.spentLast": ARS(250_000),
		});
		// The first page's cursor was saved with the second page's rows.
		expect(online.calls.filter((c) => c.startsWith("expenses"))).toEqual([
			"expenses(c1)",
		]);
		await second.dispose({ wipe: false });

		// And now the copy is whole.
		expect(await spent(launch(phone, offline().api))).toEqual({
			"glance.spent": ARS(100_000),
			"glance.spentLast": ARS(250_000),
		});
	});
});

describe("when the account goes", () => {
	const gone = (phone: Phone) => {
		expect(phone.files.size).toBe(0);
		expect(phone.secrets.values.has(engineKeyName(SCOPE))).toBe(false);
	};

	it("leaves no file and no key when it is disposed during a pull", async () => {
		const phone = cipherFake(dir);
		const api = served();
		let release = () => {};
		let reach = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const reached = new Promise<void>((resolve) => {
			reach = resolve;
		});
		const route = (
			api.api.sync as unknown as Record<string, (q: object) => Promise<unknown>>
		).expenses as (q: object) => Promise<unknown>;
		(api.api.sync as unknown as Record<string, unknown>).expenses = async (
			q: object,
		) => {
			reach();
			await held;
			return route(q);
		};
		const engine = launch(phone, api.api);
		const pulling = engine.pull();
		// The pull is at the held request, with its settings already on disk.
		await reached;
		expect(phone.files.has(engineFileName(SCOPE))).toBe(true);

		await engine.dispose({ wipe: true });
		release();
		await pulling;
		gone(phone);
		expect(await readIndex(phone.secrets)).toEqual([]);
		expect(engine.status).toBe("failed");
		// A disposed engine never opens the file again.
		await engine.pull();
		gone(phone);
	});

	it("leaves nothing when it is disposed while the file is still being opened", async () => {
		const phone = cipherFake(dir);
		const engine = launch(phone, served().api);
		await engine.dispose({ wipe: true });
		gone(phone);
		expect(await readIndex(phone.secrets)).toEqual([]);
	});
});

describe("a server that cannot honor a cursor", () => {
	it("wipes the file, makes a new key and file, and pulls again", async () => {
		const phone = cipherFake(dir);
		const first = launch(phone, served().api);
		await first.pull();
		const oldKey = phone.secrets.values.get(engineKeyName(SCOPE));
		await first.dispose({ wipe: false });

		const reset = served({
			expensePages: [page([E2], "c9")],
			fail: {
				route: "expenses",
				pull: 1,
				error: Object.assign(new Error("gone"), {
					code: "sync_reset_required",
				}),
			},
		});
		// Same engine, second pull: the 410 comes for the saved cursor.
		const second = createDeviceEngine(reset.api, "u1", Date.now, {
			storage: (hooks) => openEngineStorage(phone.deps, SCOPE, hooks),
		});
		await second.pull();
		expect(second.status).toBe("ready");
		const newKey = phone.secrets.values.get(engineKeyName(SCOPE));
		expect(newKey).toMatch(/^[0-9a-f]{64}$/);
		expect(newKey).not.toBe(oldKey);
		expect(phone.files.size).toBe(1);
		await second.dispose({ wipe: false });

		// What is on disk now is the server's rows after the reset, and nothing older.
		const third = launch(phone, offline().api);
		expect(await spent(third)).toEqual({
			"glance.spent": ARS(0),
			"glance.spentLast": ARS(200_000),
		});
	});
});

describe("a reset that ends offline", () => {
	it("leaves an empty engine that pulls again on the next read", async () => {
		const phone = cipherFake(dir);
		const first = launch(phone, served().api);
		await first.pull();
		await first.dispose({ wipe: false });

		const server = served({
			expensePages: [page([E1, E2, E3], "c1")],
			fail: {
				route: "expenses",
				pull: 1,
				error: Object.assign(new Error("gone"), {
					code: "sync_reset_required",
				}),
			},
		});
		// The second settings call is the one after the reset: the network is gone.
		const sync = server.api.sync as unknown as Record<
			string,
			() => Promise<unknown>
		>;
		const settings = sync.settings as () => Promise<unknown>;
		let settingsCalls = 0;
		sync.settings = async () => {
			settingsCalls += 1;
			if (settingsCalls === 2) throw new Error("offline");
			return settings();
		};
		const engine = launch(phone, server.api);
		await engine.pull();
		// Nothing is held, so this is neither ready nor failed.
		expect(engine.status).toBe("idle");

		expect(await spent(engine)).toEqual({
			"glance.spent": ARS(100_000),
			"glance.spentLast": ARS(250_000),
		});
		expect(engine.status).toBe("ready");
	});
});

describe("a disk that fails", () => {
	it("gives it up, deletes file and key, and the engine goes on in memory", async () => {
		const phone = cipherFake(dir);
		const failing = { on: false };
		const open = phone.deps.openFile;
		phone.deps.openFile = (name) => {
			const driver: SqlDriver = open(name);
			return {
				...driver,
				transaction: (fn) => {
					if (failing.on)
						throw Object.assign(new Error("full"), { errcode: 13 });
					return driver.transaction(fn);
				},
			};
		};
		const engine = launch(phone, served().api);
		await engine.read([]);
		failing.on = true;
		await engine.pull();

		expect(engine.status).toBe("ready");
		expect((await spent(engine))["glance.spent"]).toEqual(ARS(100_000));
		await Promise.resolve();
		expect(phone.files.size).toBe(0);
		expect(phone.secrets.values.has(engineKeyName(SCOPE))).toBe(false);
		expect(JSON.stringify(warnings())).toContain("disk copy given up");
		expect(JSON.stringify(warnings())).toContain("full");
	});
});

describe("a dispose while the database is still opening", () => {
	it.each([true, false])(
		"honors wipe: %s when the open finishes",
		async (wipe) => {
			let release = () => {};
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			const dispose = jest.fn(async () => {});
			const engine = createDeviceEngine(served().api, "u1", Date.now, {
				storage: async () => {
					await gate;
					return {
						loaded: {
							rows: {},
							cursors: {},
							complete: false,
							wiped: false,
							rowCount: 0,
						},
						persistence: {
							state: "live",
							commit: () => {},
							beginPull: () => {},
							finishPull: () => {},
							abandonPull: () => {},
							close: () => {},
						},
						dispose,
					};
				},
			});
			const disposing = engine.dispose({ wipe });
			release();
			await disposing;
			expect(dispose).toHaveBeenCalledTimes(1);
			expect(dispose).toHaveBeenCalledWith({ wipe });
		},
	);
});

describe("rows the store will not take", () => {
	it("wipes the disk copy and starts empty in memory", async () => {
		const dispose = jest.fn(async () => {});
		const engine = createDeviceEngine(served().api, "u1", Date.now, {
			storage: async () => ({
				// A settings row with the wrong id is refused by the store.
				loaded: {
					rows: { settings: [{ id: "not-user" } as never] },
					cursors: { expenses: "stale" },
					complete: true,
					wiped: false,
					rowCount: 1,
				},
				persistence: {
					state: "live",
					commit: () => {},
					beginPull: () => {},
					finishPull: () => {},
					abandonPull: () => {},
					close: () => {},
				},
				dispose,
			}),
		});
		expect(await spent(engine)).toEqual({
			"glance.spent": ARS(100_000),
			"glance.spentLast": ARS(250_000),
		});
		expect(dispose).toHaveBeenCalledWith({ wipe: true });
	});
});

function warnings() {
	return jest.mocked(console.warn).mock.calls;
}
