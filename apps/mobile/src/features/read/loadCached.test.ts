import { createReadCache } from "@/data/cache";
import { createMemoryStore } from "@/data/store";
import { loadCached } from "./loadCached";

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
