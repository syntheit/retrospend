import { createReadCache } from "@/data/cache";
import { createMemoryStore } from "@/data/store";
import {
	loadCached,
	REWRITE_AFTER_MS,
	type ReadState,
	sameData,
	settle,
} from "./loadCached";

const KEY = { name: "thing", schema: 1 };
const fail = async (): Promise<string> => {
	throw new Error("offline");
};

describe("loadCached", () => {
	it("reads straight from the server when there is no store", async () => {
		expect(
			await loadCached(
				null,
				KEY,
				async () => "now",
				() => {},
			),
		).toEqual({
			status: "ready",
			data: "now",
			staleSince: null,
			refreshing: false,
		});
		expect(await loadCached(null, KEY, fail, () => {})).toEqual({
			status: "error",
		});
	});

	it("keeps only the newest entries of a family when asked to prune", async () => {
		let tick = 0;
		const store = createMemoryStore();
		const cache = createReadCache(
			store,
			"a",
			() => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
		);
		for (const id of ["1", "2", "3"]) {
			await loadCached(
				cache,
				{ name: `person.${id}`, schema: 1 },
				async () => id,
				() => {},
				{ prefix: "person.", keep: 2 },
			);
		}
		expect(await store.keys("cache:a:person.")).toEqual([
			"cache:a:person.2",
			"cache:a:person.3",
		]);
	});

	it("caches a fresh read and shows the cache first next time", async () => {
		const cache = createReadCache(createMemoryStore(), "a");
		expect(
			await loadCached(
				cache,
				KEY,
				async () => [1],
				() => {},
			),
		).toEqual({
			status: "ready",
			data: [1],
			staleSince: null,
			refreshing: false,
		});
		const early: unknown[] = [];
		await loadCached(
			cache,
			KEY,
			async () => [2],
			(s) => early.push(s),
		);
		expect(early).toEqual([
			{
				status: "ready",
				data: [1],
				staleSince: null,
				refreshing: true,
			},
		]);
	});

	it("keeps the cache, marked stale, when the refresh fails", async () => {
		const cache = createReadCache(createMemoryStore(), "a");
		await cache.write(KEY.name, KEY.schema, "old");
		expect(await loadCached(cache, KEY, fail, () => {})).toEqual({
			status: "ready",
			data: "old",
			staleSince: expect.stringMatching(/^\d{4}-/),
			refreshing: false,
		});
	});

	it("is an error when the refresh fails and nothing is cached", async () => {
		const cache = createReadCache(createMemoryStore(), "a");
		expect(await loadCached(cache, KEY, fail, () => {})).toEqual({
			status: "error",
		});
	});

	it("ignores a cached read of another schema", async () => {
		const cache = createReadCache(createMemoryStore(), "a");
		await cache.write(KEY.name, 0, "old");
		const early: unknown[] = [];
		await loadCached(
			cache,
			KEY,
			async () => "new",
			(s) => early.push(s),
		);
		expect(early).toEqual([]);
	});
});

describe("loadCached disk writes", () => {
	it("does not write rows that did not change", async () => {
		const cache = createReadCache(createMemoryStore(), "a");
		await loadCached(
			cache,
			KEY,
			async () => ({ n: 1 }),
			() => {},
		);
		const write = jest.spyOn(cache, "write");
		await loadCached(
			cache,
			KEY,
			async () => ({ n: 1 }),
			() => {},
		);
		expect(write).not.toHaveBeenCalled();
		await loadCached(
			cache,
			KEY,
			async () => ({ n: 2 }),
			() => {},
		);
		expect(write).toHaveBeenCalledTimes(1);
	});

	it("writes unchanged rows again once the entry is an hour old", async () => {
		const cache = createReadCache(createMemoryStore(), "a");
		await loadCached(
			cache,
			KEY,
			async () => ({ n: 1 }),
			() => {},
		);
		const write = jest.spyOn(cache, "write");
		await loadCached(
			cache,
			KEY,
			async () => ({ n: 1 }),
			() => {},
			undefined,
			{
				now: () => Date.now() + REWRITE_AFTER_MS + 1000,
			},
		);
		expect(write).toHaveBeenCalledTimes(1);
	});

	it("does not prune when it wrote nothing", async () => {
		const cache = createReadCache(createMemoryStore(), "a");
		const prune = { prefix: "person.", keep: 2 };
		await loadCached(
			cache,
			KEY,
			async () => 1,
			() => {},
			prune,
		);
		const spy = jest.spyOn(cache, "prune");
		await loadCached(
			cache,
			KEY,
			async () => 1,
			() => {},
			prune,
		);
		expect(spy).not.toHaveBeenCalled();
	});

	it("answers from the cache alone when that is enough, and asks the server when there is none", async () => {
		const cache = createReadCache(createMemoryStore(), "a");
		const fetch = jest.fn(async () => "server");
		const empty = await loadCached(cache, KEY, fetch, () => {}, undefined, {
			cachedIsEnough: true,
		});
		expect(empty).toMatchObject({ status: "ready", data: "server" });
		expect(fetch).toHaveBeenCalledTimes(1);
		const cached = await loadCached(cache, KEY, fetch, () => {}, undefined, {
			cachedIsEnough: true,
		});
		expect(cached).toEqual({
			status: "ready",
			data: "server",
			staleSince: null,
			refreshing: false,
		});
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});

describe("settle", () => {
	const ready = (
		data: unknown,
		extra: Partial<{ staleSince: string | null; refreshing: boolean }> = {},
	): ReadState<unknown> => ({
		status: "ready",
		data,
		staleSince: null,
		refreshing: false,
		...extra,
	});

	it("keeps the very same state when the answer is the same rows", () => {
		const prev = ready({ a: [1, 2] });
		expect(settle(prev, ready({ a: [1, 2] }))).toBe(prev);
	});

	it("keeps the old rows, with the new flags, when only a flag changed", () => {
		const prev = ready({ a: 1 }, { refreshing: true });
		const next = settle(prev, ready({ a: 1 }));
		expect(next).not.toBe(prev);
		expect((next as { data: unknown }).data).toBe(
			(prev as { data: unknown }).data,
		);
		expect(next).toMatchObject({ refreshing: false });
	});

	it("takes the new state when the rows changed or the old state was not rows", () => {
		const changed = ready({ a: 2 });
		expect(settle(ready({ a: 1 }), changed)).toBe(changed);
		expect(settle({ status: "loading" }, changed)).toBe(changed);
		expect(settle(ready(1), { status: "error" })).toEqual({ status: "error" });
	});
});

describe("sameData", () => {
	it("compares rows by value, and plain values by identity", () => {
		expect(sameData({ a: [1] }, { a: [1] })).toBe(true);
		expect(sameData({ a: [1] }, { a: [2] })).toBe(false);
		expect(sameData(1, 1)).toBe(true);
		expect(sameData("a", "b")).toBe(false);
		expect(sameData(null, { a: 1 })).toBe(false);
	});
});
