import type { OutboxEntry } from "@/data/outbox";
import {
	mergePending,
	type PendingContext,
	pendingPage,
	pendingRow,
	pendingRows,
} from "./pending";
import type { ActivityItem, ActivityPage } from "./source";

// Entries written on the phone join the Activity read as rows marked
// `unsynced`, sorted by their date with the server's, and leave it when the
// server lists them (no double) or they are parked.

const ctx: PendingContext = {
	categories: new Map([
		["food", { id: "food", name: "Food", icon: null, tone: 3 }],
	]),
	places: new Map([
		["a1", "Checking"],
		["a2", "Savings"],
	]),
	transferWord: "Transfer",
};

function entry(
	entity: string,
	clientId: string,
	payload: Record<string, unknown>,
	over: Partial<OutboxEntry> = {},
): OutboxEntry {
	return {
		clientId,
		entity,
		kind: "create",
		targetId: clientId,
		baseVersion: null,
		payload,
		createdAt: "2026-11-02T10:00:00.000Z",
		attempts: 0,
		networkFailures: 0,
		serverErrors: 0,
		state: "pending",
		lastError: null,
		...over,
	};
}

const coffee = entry("expenses", "e1", {
	id: "e1",
	title: "Coffee",
	amount: "3.50",
	currency: "USD",
	date: "2026-11-02",
	categoryId: "food",
});

function serverRow(over: Partial<ActivityItem>): ActivityItem {
	return {
		id: "x",
		source: "personal",
		entityId: "x",
		kind: "expense",
		title: "Server row",
		category: null,
		amount: { minor: 100, currency: "USD" },
		sortKey: 100,
		project: null,
		date: "2026-11-02",
		mine: true,
		locked: false,
		canEdit: true,
		...over,
	};
}

function pageOf(
	items: ActivityItem[],
	over: Partial<ActivityPage> = {},
): ActivityPage {
	return {
		items,
		nextCursor: null,
		today: "2026-11-02",
		homeCurrency: "USD",
		count: items.length,
		total: null,
		dayTotals: null,
		missingRates: [],
		elsewhere: null,
		...over,
	};
}

describe("a waiting entry as a row", () => {
	it("draws an expense with its category, marked not synced", () => {
		const row = pendingRow(coffee, ctx);
		expect(row).toMatchObject({
			id: "e1",
			entityId: "e1",
			source: "personal",
			kind: "expense",
			title: "Coffee",
			amount: { minor: 350, currency: "USD" },
			date: "2026-11-02",
			category: { id: "food", name: "Food", tone: 3 },
			unsynced: true,
			canEdit: true,
		});
	});

	it("shows a foreign amount as entered, with no home value and no guessed rate", () => {
		const row = pendingRow(
			entry("expenses", "e2", {
				title: "Ramen",
				amount: "1500",
				currency: "JPY",
				date: "2026-11-02",
			}),
			ctx,
		);
		expect(row?.amount).toEqual({ minor: 1500, currency: "JPY" });
		expect(row?.home).toBeUndefined();
	});

	it("draws income, a transfer and a split", () => {
		expect(
			pendingRow(
				entry("income", "i1", {
					title: "Salary",
					amount: "1000",
					currency: "USD",
					date: "2026-11-01",
				}),
				ctx,
			),
		).toMatchObject({ kind: "income", title: "Salary", unsynced: true });
		expect(
			pendingRow(
				entry("transfers", "t1", {
					fromAccountId: "a1",
					toAccountId: "a2",
					fromCurrency: "USD",
					toCurrency: "USD",
					fromAmount: "50",
					date: "2026-11-02",
				}),
				ctx,
			),
		).toMatchObject({ kind: "transfer", title: "Checking > Savings" });
		const split = pendingRow(
			entry("shared-expenses", "s1", {
				description: "Dinner",
				amount: "40",
				currency: "USD",
				date: "2026-11-02",
				splitMode: "EQUAL",
				splitWith: [],
			}),
			ctx,
		);
		expect(split).toMatchObject({
			id: "shared:s1",
			entityId: "s1",
			source: "shared",
			canEdit: true,
		});
	});

	it("can not edit a custom split or a project's, only delete it", () => {
		const row = pendingRow(
			entry("shared-expenses", "s2", {
				description: "Rent",
				amount: "900",
				currency: "USD",
				date: "2026-11-02",
				splitMode: "PERCENTAGE",
			}),
			ctx,
		);
		expect(row?.canEdit).toBe(false);
	});

	it("leaves out what is not a create or does not read", () => {
		expect(pendingRow({ ...coffee, kind: "delete" }, ctx)).toBeNull();
		expect(pendingRow(entry("budgets", "b1", {}), ctx)).toBeNull();
		expect(pendingRow(entry("expenses", "e3", { title: "x" }), ctx)).toBeNull();
	});

	it("keeps a parked entry out: Couldn't sync shows those", () => {
		const parked = { ...coffee, clientId: "e9", state: "conflict" as const };
		expect(pendingRows([coffee, parked], ctx).map((r) => r.id)).toEqual(["e1"]);
	});
});

describe("merging waiting rows into the server's page", () => {
	const rows = (...entries: OutboxEntry[]) => pendingRows(entries, ctx);

	it("sorts a waiting row by its date among the server's, newest write first in a day", () => {
		const page = pageOf([
			serverRow({ id: "a", entityId: "a", date: "2026-11-02" }),
			serverRow({ id: "b", entityId: "b", date: "2026-10-30" }),
		]);
		const lunch = entry("expenses", "e4", {
			title: "Lunch",
			amount: "9",
			currency: "USD",
			date: "2026-11-01",
		});
		const merged = mergePending(page, rows(coffee, lunch));
		expect(merged.items.map((i) => i.id)).toEqual(["e1", "a", "e4", "b"]);
		// The server's figures stay the server's.
		expect(merged.count).toBe(page.count);
		expect(merged.dayTotals).toBe(page.dayTotals);
	});

	it("swaps to the server's row when the server lists it: no duplicate", () => {
		const synced = serverRow({
			id: "e1",
			entityId: "e1",
			title: "Coffee",
		});
		const merged = mergePending(pageOf([synced]), rows(coffee));
		expect(merged.items).toEqual([synced]);
		expect(merged.items.some((i) => i.unsynced)).toBe(false);
	});

	it("matches a split by the entry it is about, not its row id", () => {
		const split = entry("shared-expenses", "s1", {
			description: "Dinner",
			amount: "40",
			currency: "USD",
			date: "2026-11-02",
			splitMode: "EQUAL",
		});
		const synced = serverRow({
			id: "shared:s1",
			entityId: "s1",
			source: "shared",
		});
		expect(mergePending(pageOf([synced]), rows(split)).items).toEqual([synced]);
	});

	it("waits for its page when it is older than what is loaded", () => {
		const page = pageOf(
			[serverRow({ id: "a", entityId: "a", date: "2026-11-02" })],
			{ nextCursor: "next" },
		);
		const old = entry("expenses", "e5", {
			title: "Old",
			amount: "1",
			currency: "USD",
			date: "2026-09-01",
		});
		expect(mergePending(page, rows(old)).items.map((i) => i.id)).toEqual(["a"]);
	});

	it("returns the same page when nothing waits", () => {
		const page = pageOf([serverRow({})]);
		expect(mergePending(page, [])).toBe(page);
	});

	it("builds a page of only the waiting rows when nothing is cached", () => {
		const page = pendingPage(rows(coffee), {
			today: "2026-11-02",
			homeCurrency: "USD",
		});
		expect(page.items.map((i) => i.id)).toEqual(["e1"]);
		expect(page.total).toBeNull();
		expect(page.nextCursor).toBeNull();
	});
});
