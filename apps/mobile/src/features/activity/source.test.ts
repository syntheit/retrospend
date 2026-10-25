import { createReadCache } from "@/data/cache";
import { createMemoryStore } from "@/data/store";
import { DEFAULT_FILTER } from "./filter";
import {
	ACTIVITY_CACHE,
	type ActivityItem,
	type ActivityPage,
	type ActivitySource,
	appendPage,
	loadActivity,
} from "./source";

const row = (id: string, date = "2026-10-21"): ActivityItem => ({
	id,
	source: "personal",
	entityId: id,
	kind: "expense",
	title: `Row ${id}`,
	category: null,
	amount: { minor: 450000, currency: "ARS" },
	sortKey: 450000,
	project: null,
	date,
	mine: true,
	locked: false,
	canEdit: true,
});

const page = (
	items: ActivityItem[],
	more: Partial<ActivityPage> = {},
): ActivityPage => ({
	items,
	nextCursor: null,
	today: "2026-10-25",
	homeCurrency: "ARS",
	count: items.length,
	total: null,
	dayTotals: {},
	missingRates: [],
	elsewhere: null,
	...more,
});

const source = (list: ActivitySource["list"]): ActivitySource => ({ list });
const offline = source(async () => {
	throw new Error("offline");
});

describe("loadActivity", () => {
	it("caches the first page of the default list and shows it first next time", async () => {
		const cache = createReadCache(createMemoryStore(), "a");
		const fresh = source(async () => page([row("e1")]));
		expect(await loadActivity(fresh, cache, DEFAULT_FILTER, () => {})).toEqual({
			status: "ready",
			data: page([row("e1")]),
			staleSince: null,
			refreshing: false,
		});
		const early: unknown[] = [];
		await loadActivity(fresh, cache, DEFAULT_FILTER, (s) => early.push(s));
		expect(early).toEqual([
			{
				status: "ready",
				data: page([row("e1")]),
				staleSince: null,
				refreshing: true,
			},
		]);
	});

	it("keeps the cache, marked stale, when the refresh fails", async () => {
		const cache = createReadCache(createMemoryStore(), "a");
		await cache.write(
			ACTIVITY_CACHE.name,
			ACTIVITY_CACHE.schema,
			page([row("e1")]),
		);
		expect(
			await loadActivity(offline, cache, DEFAULT_FILTER, () => {}),
		).toEqual({
			status: "ready",
			data: page([row("e1")]),
			staleSince: expect.stringMatching(/^\d{4}-/),
			refreshing: false,
		});
	});

	it("is an error when the refresh fails and nothing is cached", async () => {
		const cache = createReadCache(createMemoryStore(), "a");
		expect(
			await loadActivity(offline, cache, DEFAULT_FILTER, () => {}),
		).toEqual({
			status: "error",
		});
	});

	it("reads a filtered list live and never caches it", async () => {
		const cache = createReadCache(createMemoryStore(), "a");
		const seen: (string | undefined)[] = [];
		const filtered = source(async ({ filter }) => {
			seen.push(filter);
			return page([row("e2")]);
		});
		const state = await loadActivity(
			filtered,
			cache,
			{ ...DEFAULT_FILTER, categoryId: "c1" },
			() => {},
		);
		expect(seen).toEqual(["cat=c1"]);
		expect(state.status).toBe("ready");
		expect(
			await cache.read(ACTIVITY_CACHE.name, ACTIVITY_CACHE.schema),
		).toBeNull();
	});
});

describe("appendPage", () => {
	it("adds the next page, keeps the first page's count, and drops repeats", () => {
		const first = page([row("a"), row("b")], {
			nextCursor: "c1",
			count: 3,
			dayTotals: { "2026-10-21": { minor: 1, currency: "ARS" } },
		});
		const next = page([row("b"), row("c", "2026-10-20")], {
			nextCursor: null,
			count: null,
			dayTotals: { "2026-10-20": { minor: 2, currency: "ARS" } },
		});
		const joined = appendPage(first, next);
		expect(joined.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
		expect(joined.nextCursor).toBeNull();
		expect(joined.count).toBe(3);
		expect(Object.keys(joined.dayTotals ?? {})).toEqual([
			"2026-10-21",
			"2026-10-20",
		]);
	});
});
