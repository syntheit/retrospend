import { createReadCache } from "@/data/cache";
import { createMemoryStore } from "@/data/store";
import {
	ACTIVITY_CACHE,
	type ActivityItem,
	type ActivitySource,
	loadActivity,
} from "./source";

const item: ActivityItem = {
	id: "e1",
	title: "Coffee",
	subline: "Food, Oct 21",
	amount: { minor: 450000, currency: "ARS" },
	version: "2026-10-21T10:00:00Z",
};

const source = (impl: ActivitySource["list"]): ActivitySource => ({
	list: impl,
});

describe("loadActivity", () => {
	it("reports unavailable when the server has no list route", async () => {
		const cache = createReadCache(createMemoryStore(), "a");
		const state = await loadActivity(
			source(async () => ({ status: "unavailable" })),
			cache,
			() => {},
		);
		expect(state).toEqual({ status: "unavailable" });
	});

	it("caches a fresh page and shows the cache first next time", async () => {
		const cache = createReadCache(createMemoryStore(), "a");
		const fresh = source(async () => ({
			status: "ok",
			items: [item],
			nextCursor: null,
		}));
		expect(await loadActivity(fresh, cache, () => {})).toEqual({
			status: "ready",
			items: [item],
			staleSince: null,
		});
		const early: unknown[] = [];
		await loadActivity(fresh, cache, (s) => early.push(s));
		expect(early).toEqual([
			{
				status: "ready",
				items: [item],
				staleSince: expect.stringMatching(/^\d{4}-/),
			},
		]);
	});

	it("keeps the cache, marked stale, when the refresh fails", async () => {
		const cache = createReadCache(createMemoryStore(), "a");
		await cache.write(ACTIVITY_CACHE.name, ACTIVITY_CACHE.schema, [item]);
		const offline = source(async () => {
			throw new Error("offline");
		});
		expect(await loadActivity(offline, cache, () => {})).toEqual({
			status: "ready",
			items: [item],
			staleSince: expect.stringMatching(/^\d{4}-/),
		});
	});

	it("is an error when the refresh fails and nothing is cached", async () => {
		const cache = createReadCache(createMemoryStore(), "a");
		const offline = source(async () => {
			throw new Error("offline");
		});
		expect(await loadActivity(offline, cache, () => {})).toEqual({
			status: "error",
		});
	});
});
