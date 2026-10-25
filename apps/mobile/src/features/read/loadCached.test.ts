import { createReadCache } from "@/data/cache";
import { createMemoryStore } from "@/data/store";
import { loadCached } from "./loadCached";

const KEY = { name: "thing", schema: 1 };
const fail = async (): Promise<string> => {
	throw new Error("offline");
};

describe("loadCached", () => {
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
				staleSince: expect.stringMatching(/^\d{4}-/),
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
