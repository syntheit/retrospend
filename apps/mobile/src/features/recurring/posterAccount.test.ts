import type { RetrospendClient } from "@retrospend/api-client";
import { cursor, template } from "@retrospend/engine/device-fake";
import { engineFor, liveEngineOf } from "@/data/device-engine";
import { engineScope } from "@/data/engine-db/names";
import { sweepEngineDbs } from "@/data/engine-db/sweep";
import { createOutbox } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import { transportFor } from "@/data/transport";
import { flushEntries } from "@/features/entry/queue";
import { cipherFake } from "../../../test/cipherFake";
import { fakeDeviceApi } from "../../../test/deviceApi";
import { removeDir, tempDir } from "../../../test/nodeSqlite";
import { postForAccount } from "./posterAccount";

// The background task and the app share one process on Android. One engine
// holds an account's file: the task posts through the app's engine when there
// is one, and otherwise builds its own and gives it back. ARS home, a monthly
// USD 20 template due 2026-12-01T03:00Z, blue 1,545: one period is due.

// Which scopes had their sweep entry taken back, and by whom.
const mockUnregistered: string[] = [];
jest.mock("@/data/engine-db/sweep", () => {
	const actual = jest.requireActual("@/data/engine-db/sweep");
	return {
		...actual,
		registerLiveEngine: (scope: string, dispose: () => Promise<void>) => {
			const take = actual.registerLiveEngine(scope, dispose);
			return () => {
				mockUnregistered.push(scope);
				take();
			};
		},
	};
});

jest.mock("@/data/ids", () => {
	let n = 0;
	return { newClientId: () => `c${n++}` };
});

const ORIGIN = "https://money.example.test";
const WHO = { baseUrl: ORIGIN, meId: "u1" };
const page = (items: unknown[]) => ({
	items,
	tombstones: [],
	cursor: cursor("100"),
	hasMore: false,
});
const RATES = {
	asOf: "2026-12-01T00:00:00.000Z",
	rates: [
		{
			id: "r1",
			currency: "ARS",
			type: "blue",
			date: "2026-12-01T00:00:00.000Z",
			unitsPerUsd: "1545",
		},
	],
};

function client(gate?: Promise<void>, offline = false) {
	const fake = fakeDeviceApi({
		rates: RATES,
		expenses: [page([])],
		transfers: [page([])],
		templates: [page([template("t1")])],
	});
	const confirm = jest.fn(async (_input?: unknown, _options?: unknown) => {
		if (offline) throw new Error("Network request failed");
		return {
			undo: "tok",
			confirmed: { templateUpdatedAt: "2026-12-01T03:06:00.000Z" },
		};
	});
	const api = Object.assign(fake.client, {
		recurring: { confirm },
		protection: {
			keys: async () => {
				throw Object.assign(new Error("none"), { status: 404 });
			},
		},
		platform: {
			serverInfo: async () => {
				await gate;
				return { features: { autoPost: true } };
			},
		},
	}) as RetrospendClient;
	return { api, confirm };
}

let dir: string;
let phone: ReturnType<typeof cipherFake>;
let events: string[];
beforeEach(() => {
	mockUnregistered.length = 0;
	process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE = "1";
	jest.useFakeTimers({ now: new Date("2026-12-01T03:05:00.000Z") });
	jest.spyOn(console, "warn").mockImplementation(() => {});
	dir = tempDir();
	phone = cipherFake(dir);
	events = [];
	const { openFile } = phone.deps;
	phone.deps.openFile = (name) => {
		events.push("open");
		const driver = openFile(name);
		return {
			...driver,
			close: () => {
				events.push("close");
				driver.close();
			},
		};
	};
});
afterEach(async () => {
	// No engine outlives its test: the next one finds none running.
	await sweepEngineDbs(null, phone.deps);
	delete process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE;
	jest.useRealTimers();
	jest.restoreAllMocks();
	removeDir(dir);
});

const appEngine = async () => {
	const app = client();
	const outbox = createOutbox(createMemoryStore(), `${ORIGIN}|u1`);
	const engine = engineFor(app.api, "u1", ORIGIN, phone.deps, outbox);
	await engine.pull();
	return { ...app, outbox, engine };
};

describe("the task while the app's engine is running", () => {
	it("posts through the app's engine and client, builds nothing, and leaves the registry as it was", async () => {
		const app = await appEngine();
		const makeClient = jest.fn();
		const makeOutbox = jest.fn();
		const out = await postForAccount(WHO, {
			makeClient,
			makeOutbox,
			openDeps: phone.deps,
		});
		expect(out).toMatchObject({ status: "ran", queued: 1 });
		expect(makeClient).not.toHaveBeenCalled();
		expect(makeOutbox).not.toHaveBeenCalled();
		expect(app.confirm).toHaveBeenCalledTimes(1);
		expect(liveEngineOf(ORIGIN, "u1")?.engine).toBe(app.engine);
		expect(app.engine.disposed).toBe(false);
	});

	it("a later sign-out closes the app's engine before its file goes", async () => {
		const app = await appEngine();
		await postForAccount(WHO, {
			makeClient: jest.fn(),
			makeOutbox: jest.fn(),
			openDeps: phone.deps,
		});
		await sweepEngineDbs(null, phone.deps);
		expect(app.engine.disposed).toBe(true);
		expect(phone.files.size).toBe(0);
		expect(events.at(-1)).toBe("close");
	});
});

describe("the task with no engine running", () => {
	it("builds its own, posts, and closes it without wiping the file or leaving an entry", async () => {
		const task = client();
		const makeOutbox = jest.fn(() =>
			createOutbox(createMemoryStore(), `${ORIGIN}|u1`),
		);
		const out = await postForAccount(WHO, {
			makeClient: () => task.api,
			makeOutbox,
			openDeps: phone.deps,
		});
		expect(out).toMatchObject({ status: "ran", queued: 1 });
		expect(task.confirm).toHaveBeenCalledTimes(1);
		expect(liveEngineOf(ORIGIN, "u1")).toBeNull();
		// Its own sweep entry is taken back: a sign-out never calls a closed engine.
		expect(mockUnregistered).toEqual([engineScope(ORIGIN, "u1")]);
		// Closed, file kept: the app's next launch reads it.
		expect(events).toEqual(["open", "close"]);
		expect(phone.files.size).toBe(1);
	});

	it("an app that opens meanwhile takes the file over: the task's engine closes first, and the task's release leaves the app's entry", async () => {
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const task = client(gate);
		const running = postForAccount(WHO, {
			makeClient: () => task.api,
			makeOutbox: () => createOutbox(createMemoryStore(), `${ORIGIN}|u1`),
			openDeps: phone.deps,
		});
		// The task's engine has pulled and waits on the server's answer.
		await jest.advanceTimersByTimeAsync(0);
		expect(liveEngineOf(ORIGIN, "u1")).not.toBeNull();
		const app = await appEngine();
		release();
		await running;
		// One connection at a time: the task's closed before the app's opened.
		expect(events).toEqual(["open", "close", "open"]);
		expect(liveEngineOf(ORIGIN, "u1")?.engine).toBe(app.engine);
		await sweepEngineDbs(null, phone.deps);
		expect(app.engine.disposed).toBe(true);
	});
});

describe("the app signing in again over its own engine", () => {
	it("opens the file only after the old engine's wipe has finished, so the new copy survives it", async () => {
		const app = client();
		const first = engineFor(
			app.api,
			"u1",
			ORIGIN,
			phone.deps,
			createOutbox(createMemoryStore(), `${ORIGIN}|u1`),
		);
		await first.pull();
		// The old engine's wipe is slow: its key goes only once the gate opens.
		let open: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			open = resolve;
		});
		const deleteKey = phone.secrets.delete;
		phone.secrets.delete = async (name) => {
			await gate;
			return deleteKey(name);
		};
		const second = engineFor(
			app.api,
			"u1",
			ORIGIN,
			phone.deps,
			createOutbox(createMemoryStore(), `${ORIGIN}|u1`),
		);
		await jest.advanceTimersByTimeAsync(0);
		open();
		await second.pull();
		expect(first.disposed).toBe(true);
		expect(second.disposed).toBe(false);
		// The new engine's file and key are still there, the old ones are not.
		expect(phone.files.size).toBe(1);
		const keys = [...phone.secrets.values.keys()].filter((k) =>
			k.includes(engineScope(ORIGIN, "u1")),
		);
		expect(keys).toHaveLength(1);
		expect(events.filter((e) => e === "open")).toHaveLength(2);
	});
});

describe("the app opening between a period's queueing and its flush", () => {
	it("leaves one entry for the period, and the app's flush sends it once under the same id", async () => {
		const shared = createMemoryStore();
		const scope = `${ORIGIN}|u1`;
		const appOutbox = createOutbox(shared, scope);
		const app = client();
		// The task has no network, so its entry waits for the app's flush.
		const task = client(undefined, true);
		const taskOutbox = createOutbox(shared, scope);
		let appEngineOf: ReturnType<typeof engineFor> | null = null;

		const enqueue = taskOutbox.enqueue.bind(taskOutbox);
		taskOutbox.enqueue = async (entry) => {
			const queued = await enqueue(entry);
			// Booked and queued; not yet flushed: the app comes up over the file.
			appEngineOf = engineFor(app.api, "u1", ORIGIN, phone.deps, appOutbox);
			return queued;
		};
		await postForAccount(WHO, {
			makeClient: () => task.api,
			makeOutbox: () => taskOutbox,
			openDeps: phone.deps,
		});
		const waiting = await appOutbox.all();
		expect(waiting).toHaveLength(1);
		expect(waiting[0]).toMatchObject({ origin: "poster", targetId: "t1" });
		expect(app.confirm).not.toHaveBeenCalled();
		const id = waiting[0]?.clientId;

		const engine = appEngineOf as ReturnType<typeof engineFor> | null;
		await engine?.pull();
		await flushEntries(appOutbox, app.api, transportFor(app.api));
		expect(app.confirm).toHaveBeenCalledTimes(1);
		const [sent, options] = app.confirm.mock.calls[0] ?? [];
		expect(sent).toMatchObject({ id: "t1", expenseId: id });
		expect(
			(options as { context: { idempotencyKey: string } }).context
				.idempotencyKey,
		).toBe(id);
		expect(await appOutbox.all()).toEqual([]);
		// The task's one try failed, so nothing reached the server twice.
		expect(task.confirm).toHaveBeenCalledTimes(1);
	});
});
