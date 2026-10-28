import { createMemoryStore } from "@/data/store";
import {
	createFeedState,
	type FeedEvent,
	MAX_PER_RUN,
	notificationsFromEvents,
	notificationsFromNeedsYou,
	pollFeed,
	pushAllowed,
} from "./feed";

const NOW = new Date("2026-10-28T12:00:00Z");

function event(over: Partial<FeedEvent> & { id: string }): FeedEvent {
	return {
		cursor: `c-${over.id}`,
		type: "shared_expense.created",
		occurredAt: "2026-10-28T11:55:00Z",
		actorUserId: "other",
		entity: { type: "shared_expense", id: `e-${over.id}` },
		...over,
	};
}

describe("events to notifications", () => {
	const base = { meId: "me", prefs: [], now: NOW };

	it("announces a change someone else made", () => {
		expect(notificationsFromEvents([event({ id: "1" })], base)).toEqual([
			{
				key: "event:1",
				kind: "shared_expense.created",
				entity: { type: "shared_expense", id: "e-1" },
			},
		]);
	});

	it("skips your own writes, unknown types and entity-less events", () => {
		const list = [
			event({ id: "1", actorUserId: "me" }),
			event({ id: "2", type: "expense.created" }),
			event({ id: "3", entity: null }),
		];
		expect(notificationsFromEvents(list, base)).toEqual([]);
	});

	it("skips events older than a day", () => {
		const old = event({ id: "1", occurredAt: "2026-10-27T11:00:00Z" });
		expect(notificationsFromEvents([old], base)).toEqual([]);
		const bad = event({ id: "2", occurredAt: "not a date" });
		expect(notificationsFromEvents([bad], base)).toEqual([]);
	});

	it("respects the per-type push switch", () => {
		const prefs = [{ type: "EXPENSE_SPLIT" as const, push: false }];
		const list = [
			event({ id: "1" }),
			event({ id: "2", type: "payment.recorded" }),
		];
		expect(
			notificationsFromEvents(list, { ...base, prefs }).map((n) => n.kind),
		).toEqual(["payment.recorded"]);
		// A type with no stored row pushes.
		expect(pushAllowed([], "EXPENSE_SPLIT")).toBe(true);
		expect(pushAllowed(prefs, "EXPENSE_SPLIT")).toBe(false);
	});
});

describe("recurring items", () => {
	const item = (
		date: string,
		type: "recurring.due" | "recurring.overdue" = "recurring.due",
	) => ({
		type,
		entity: { kind: "recurring" as const, id: "r1" },
		date,
		direction: "out" as const,
	});

	it("announces an item that fell due in the last three days, once per due day", () => {
		expect(
			notificationsFromNeedsYou([item("2026-10-28")], "2026-10-28", true),
		).toEqual([
			{
				key: "recurring:r1:2026-10-28",
				kind: "recurring.due",
				direction: "out",
				entity: { type: "recurring", id: "r1" },
			},
		]);
		expect(
			notificationsFromNeedsYou(
				[item("2026-10-25", "recurring.overdue")],
				"2026-10-28",
				true,
			),
		).toHaveLength(1);
		expect(
			notificationsFromNeedsYou(
				[item("2026-10-20", "recurring.overdue")],
				"2026-10-28",
				true,
			),
		).toEqual([]);
	});

	it("stays quiet when the switch is off", () => {
		expect(
			notificationsFromNeedsYou([item("2026-10-28")], "2026-10-28", false),
		).toEqual([]);
	});
});

describe("pollFeed", () => {
	function fakeApi(
		pages: { items: FeedEvent[]; cursor: string | null; hasMore: boolean }[],
	) {
		const list = jest.fn(async (_q: { after?: string; limit?: number }) => {
			const page = pages.shift();
			if (!page) throw new Error("no more pages");
			return page;
		});
		return {
			list,
			api: {
				events: { list },
				notifications: {
					getPreferences: async () => ({ preferences: [] }),
				},
				"needs-you": {
					list: async () => ({ items: [], today: "2026-10-28" }),
				},
			} as never,
		};
	}

	it("walks to the end without announcing the past on the first run", async () => {
		const state = createFeedState(createMemoryStore(), "s|me");
		const { api, list } = fakeApi([
			{ items: [event({ id: "1" })], cursor: "c1", hasMore: true },
			{ items: [event({ id: "2" })], cursor: "c2", hasMore: false },
		]);
		const found = await pollFeed({ api, state, meId: "me", now: NOW });
		expect(found).toEqual([]);
		expect(list).toHaveBeenNthCalledWith(1, { limit: 100 });
		expect(list).toHaveBeenNthCalledWith(2, { after: "c1", limit: 100 });
		expect(await state.getCursor()).toBe("c2");
	});

	it("announces what is new after the stored cursor and moves the cursor", async () => {
		const state = createFeedState(createMemoryStore(), "s|me");
		await state.setCursor("c2");
		const { api, list } = fakeApi([
			{ items: [event({ id: "3" })], cursor: "c3", hasMore: false },
		]);
		const found = await pollFeed({ api, state, meId: "me", now: NOW });
		expect(found.map((n) => n.key)).toEqual(["event:3"]);
		expect(list).toHaveBeenCalledWith({ after: "c2", limit: 100 });
		expect(await state.getCursor()).toBe("c3");
	});

	it("keeps the cursor when a page fails, so the next run resumes", async () => {
		const state = createFeedState(createMemoryStore(), "s|me");
		await state.setCursor("c2");
		const { api } = fakeApi([
			{ items: [event({ id: "3" })], cursor: "c3", hasMore: true },
		]);
		await expect(
			pollFeed({ api, state, meId: "me", now: NOW }),
		).rejects.toThrow();
		expect(await state.getCursor()).toBe("c3");
	});

	it("never announces the same thing twice, and caps one run", async () => {
		const state = createFeedState(createMemoryStore(), "s|me");
		await state.setCursor("c0");
		const many = Array.from({ length: MAX_PER_RUN + 3 }, (_, i) =>
			event({ id: String(i) }),
		);
		const first = fakeApi([{ items: many, cursor: "c9", hasMore: false }]);
		const found = await pollFeed({
			api: first.api,
			state,
			meId: "me",
			now: NOW,
		});
		expect(found).toHaveLength(MAX_PER_RUN);
		// The newest are kept.
		expect(found.at(-1)?.key).toBe(`event:${MAX_PER_RUN + 2}`);
		// The same events delivered again (cursor lost) announce nothing.
		await state.setCursor("c0");
		const again = fakeApi([{ items: many, cursor: "c9", hasMore: false }]);
		expect(
			await pollFeed({ api: again.api, state, meId: "me", now: NOW }),
		).toEqual([]);
	});

	it("starts again from the oldest event after an empty first run", async () => {
		const state = createFeedState(createMemoryStore(), "s|me");
		const empty = fakeApi([{ items: [], cursor: null, hasMore: false }]);
		await pollFeed({ api: empty.api, state, meId: "me", now: NOW });
		expect(await state.getCursor()).toBe("");
		const next = fakeApi([
			{ items: [event({ id: "1" })], cursor: "c1", hasMore: false },
		]);
		const found = await pollFeed({
			api: next.api,
			state,
			meId: "me",
			now: NOW,
		});
		expect(found.map((n) => n.key)).toEqual(["event:1"]);
		expect(next.list).toHaveBeenCalledWith({ limit: 100 });
	});

	it("clears the cursor and the memory", async () => {
		const state = createFeedState(createMemoryStore(), "s|me");
		await state.setCursor("c1");
		await state.remember(["a"]);
		await state.clear();
		expect(await state.getCursor()).toBeNull();
		expect(await state.seen()).toEqual([]);
	});
});
