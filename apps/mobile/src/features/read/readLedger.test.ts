import { createReadCache } from "@/data/cache";
import { createMemoryStore } from "@/data/store";
import type { ReadState } from "./loadCached";
import {
	coalesce,
	FRESH_MS,
	invalidateReads,
	isFresh,
	loadShared,
} from "./readLedger";

const KEY = { name: "ledger.thing", schema: 1 };

/** A promise the test settles by hand. */
function gate<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

const ready = <T>(data: T): ReadState<T> => ({
	status: "ready",
	data,
	staleSince: null,
	refreshing: false,
});

describe("coalesce", () => {
	it("runs one read for everyone who asks while it is on its way", async () => {
		const store = {};
		const g = gate<ReadState<string>>();
		const run = jest.fn(() => g.promise);
		const a = coalesce(store, "a", () => {}, run);
		const b = coalesce(store, "a", () => {}, run);
		g.resolve(ready("x"));
		expect(await a).toEqual(ready("x"));
		expect(await b).toEqual(ready("x"));
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("starts a new read once the last one has finished", async () => {
		const store = {};
		const run = jest.fn(async () => ready("x"));
		await coalesce(store, "a", () => {}, run);
		await coalesce(store, "a", () => {}, run);
		expect(run).toHaveBeenCalledTimes(2);
	});

	it("keeps reads of different names and stores apart", async () => {
		const g = gate<ReadState<string>>();
		const run = jest.fn(() => g.promise);
		const one = {};
		const two = {};
		const all = [
			coalesce(one, "a", () => {}, run),
			coalesce(one, "b", () => {}, run),
			coalesce(two, "a", () => {}, run),
		];
		g.resolve(ready("x"));
		await Promise.all(all);
		expect(run).toHaveBeenCalledTimes(3);
	});

	it("hands a late joiner the cached rows the first caller already got", async () => {
		const store = {};
		const g = gate<ReadState<string>>();
		let early!: (state: ReadState<string>) => void;
		const first = coalesce(
			store,
			"a",
			() => {},
			(onCached) => {
				early = onCached;
				return g.promise;
			},
		);
		const cached: ReadState<string> = { ...ready("old"), refreshing: true };
		early(cached);
		const joined: unknown[] = [];
		const second = coalesce(store, "a", (s) => joined.push(s), jest.fn());
		expect(joined).toEqual([cached]);
		g.resolve(ready("new"));
		await Promise.all([first, second]);
	});

	it("tells a joiner that arrives before the cache answered when it does", async () => {
		const store = {};
		const g = gate<ReadState<string>>();
		let early!: (state: ReadState<string>) => void;
		const first = coalesce(
			store,
			"a",
			() => {},
			(onCached) => {
				early = onCached;
				return g.promise;
			},
		);
		const joined: unknown[] = [];
		const second = coalesce(store, "a", (s) => joined.push(s), jest.fn());
		expect(joined).toEqual([]);
		early({ ...ready("old"), refreshing: true });
		expect(joined).toHaveLength(1);
		g.resolve(ready("new"));
		await Promise.all([first, second]);
	});

	it("does not let a read that starts after a write join one that started before it", async () => {
		const store = {};
		const before = gate<ReadState<string>>();
		const run = jest
			.fn()
			.mockReturnValueOnce(before.promise)
			.mockResolvedValueOnce(ready("after the write"));
		const a = coalesce(store, "a", () => {}, run);
		invalidateReads();
		const b = coalesce(store, "a", () => {}, run);
		expect(run).toHaveBeenCalledTimes(2);
		before.resolve(ready("before the write"));
		expect(await a).toEqual(ready("before the write"));
		expect(await b).toEqual(ready("after the write"));
	});
});

describe("loadShared and isFresh", () => {
	const cacheOf = () => createReadCache(createMemoryStore(), "u");

	it("is fresh for the window after the server answered, then not", async () => {
		const cache = cacheOf();
		const now = Date.now();
		expect(isFresh(cache, KEY.name, now)).toBe(false);
		await loadShared(
			cache,
			KEY,
			async () => 1,
			() => {},
		);
		expect(isFresh(cache, KEY.name, Date.now() + FRESH_MS - 1)).toBe(true);
		expect(isFresh(cache, KEY.name, Date.now() + FRESH_MS + 1)).toBe(false);
	});

	it("is not fresh after a write reached the server", async () => {
		const cache = cacheOf();
		await loadShared(
			cache,
			KEY,
			async () => 1,
			() => {},
		);
		expect(isFresh(cache, KEY.name)).toBe(true);
		invalidateReads();
		expect(isFresh(cache, KEY.name)).toBe(false);
	});

	it("is not fresh when the answer arrived after a write that began later", async () => {
		const cache = cacheOf();
		const g = gate<number>();
		const loading = loadShared(
			cache,
			KEY,
			() => g.promise,
			() => {},
		);
		invalidateReads();
		g.resolve(1);
		await loading;
		expect(isFresh(cache, KEY.name)).toBe(false);
	});

	it("is not fresh when the server could not be reached", async () => {
		const cache = cacheOf();
		await cache.write(KEY.name, KEY.schema, 1);
		await loadShared(
			cache,
			KEY,
			async () => {
				throw new Error("offline");
			},
			() => {},
		);
		expect(isFresh(cache, KEY.name)).toBe(false);
	});

	it("sends one request for two screens reading the same thing", async () => {
		const cache = cacheOf();
		const g = gate<number>();
		const fetch = jest.fn(() => g.promise);
		const a = loadShared(cache, KEY, fetch, () => {});
		const b = loadShared(cache, KEY, fetch, () => {});
		g.resolve(7);
		expect((await a).status).toBe("ready");
		expect((await b).status).toBe("ready");
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("does not count a cache-only answer as the server's", async () => {
		const cache = cacheOf();
		await cache.write(KEY.name, KEY.schema, 1);
		const fetch = jest.fn(async () => 2);
		const state = await loadShared(cache, KEY, fetch, () => {}, undefined, {
			cachedIsEnough: true,
		});
		expect(state).toEqual(ready(1));
		expect(fetch).not.toHaveBeenCalled();
		expect(isFresh(cache, KEY.name)).toBe(false);
	});
});
