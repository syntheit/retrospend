/**
 * The pull driver against a fake API that records each call. The pages are
 * small and the expected calls, rows and cursors are written out by hand.
 */
import { describe, expect, it } from "vitest";
import { fixtureRow } from "./fixtures";
import { MemoryStore } from "./memory-store";
import { BUDGET_SNAPSHOT_ID } from "./port";
import type {
	SyncEntity,
	WireExpense,
	WireOf,
	WireSettings,
	WireShares,
} from "./sync-apply";
import {
	type PullApi,
	type PullCursors,
	pullAll,
	pullShares,
} from "./sync-pull";

interface Page<E extends SyncEntity> {
	items: WireOf[E][];
	tombstones: { id: string }[];
	cursor: string;
	hasMore: boolean;
}

const SETTINGS: WireSettings = {
	homeCurrency: "ARS",
	timeZone: "America/Argentina/Buenos_Aires",
	startDay: 1,
	hiddenProjectIds: [],
	defaultRateTypes: {},
};

const SHARES: WireShares = {
	items: [],
	owed: {
		owedToYou: { minor: 0, currency: "ARS" },
		youOwe: { minor: 0, currency: "ARS" },
	},
};

const expense = (id: string, amount = "1000"): WireExpense => ({
	id,
	title: "row",
	amount,
	currency: "ARS",
	date: "2026-10-05T15:00:00.000Z",
	categoryId: null,
	amountInUSD: "0.67",
	exchangeRate: "1500",
	pricingSource: "MANUAL",
	location: null,
	description: null,
	status: "FINALIZED",
	isAmortizedParent: false,
	isAmortizedChild: false,
	parentId: null,
	amortizeMode: "INSTALLMENTS",
	keepInWealth: false,
	recurringTemplateId: null,
	budgetEnvelopeId: null,
	excludeFromAnalytics: false,
	direction: "OUT",
	entryKind: "STANDARD",
	inType: null,
	rateType: "blue",
	homeCurrency: "ARS",
	homeRate: "1",
	homeAmount: amount,
});

/** A base64url cursor, {e, t, s} as the server writes it (ASCII only). */
function cursor(e: string, t: string) {
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
	const bytes = [...JSON.stringify({ e, t, s: "9" })].map((c) =>
		c.charCodeAt(0),
	);
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const [a = 0, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
		const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
		out += alphabet[(n >> 18) & 63] ?? "";
		out += alphabet[(n >> 12) & 63] ?? "";
		if (b !== undefined) out += alphabet[(n >> 6) & 63] ?? "";
		if (c !== undefined) out += alphabet[n & 63] ?? "";
	}
	return out;
}

/** The 17 routes in the order a device pulls them, with the entity each fills. */
const ROUTES = [
	["categories", "categories"],
	["recurringTemplates", "recurringTemplates"],
	["expenses", "expenses"],
	["accounts", "accounts"],
	["accountSnapshots", "snapshots"],
	["accountLegs", "legs"],
	["accountRateTypes", "rateSwitches"],
	["budgetBooks", "budgetBooks"],
	["envelopeGroups", "envelopeGroups"],
	["envelopes", "envelopes"],
	["envelopeCategories", "envelopeCategories"],
	["budgetMovements", "budgetMovements"],
	["bookPeriods", "bookPeriods"],
	["monthCloses", "monthCloses"],
	["wealthTransfers", "wealthTransfers"],
	["payoffPlans", "payoffPlans"],
	["transfers", "transfers"],
] as const satisfies readonly (readonly [keyof PullApi["sync"], SyncEntity])[];

type Pages = { [E in SyncEntity]?: Page<E>[] };

/**
 * A server double. Each route answers its entity's queued pages in turn (an
 * empty page ending at "<route>-0" once they run out) and logs the request as
 * `route(since, limit)`. `fail` makes one route throw.
 */
function fakeApi(
	log: string[],
	pages: Pages = {},
	options: { fail?: string; settings?: WireSettings; shares?: WireShares } = {},
): PullApi {
	const taken = new Map<string, number>();
	const route =
		<E extends SyncEntity>(name: string, entity: E) =>
		async (query: { since?: string; limit: number }): Promise<Page<E>> => {
			log.push(`${name}(${query.since ?? "-"},${query.limit})`);
			if (options.fail === name) throw new Error(`${name} is down`);
			const n = taken.get(name) ?? 0;
			taken.set(name, n + 1);
			const queued = pages[entity] as Page<E>[] | undefined;
			return (
				queued?.[n] ?? {
					items: [],
					tombstones: [],
					cursor: `${name}-0`,
					hasMore: false,
				}
			);
		};
	return {
		sync: {
			settings: async () => {
				log.push("settings");
				return options.settings ?? SETTINGS;
			},
			shares: async (query) => {
				log.push(`shares(budget=${query.budget})`);
				return options.shares ?? SHARES;
			},
			categories: route("categories", "categories"),
			recurringTemplates: route("recurringTemplates", "recurringTemplates"),
			expenses: route("expenses", "expenses"),
			accounts: route("accounts", "accounts"),
			accountSnapshots: route("accountSnapshots", "snapshots"),
			accountLegs: route("accountLegs", "legs"),
			accountRateTypes: route("accountRateTypes", "rateSwitches"),
			budgetBooks: route("budgetBooks", "budgetBooks"),
			envelopeGroups: route("envelopeGroups", "envelopeGroups"),
			envelopes: route("envelopes", "envelopes"),
			envelopeCategories: route("envelopeCategories", "envelopeCategories"),
			budgetMovements: route("budgetMovements", "budgetMovements"),
			bookPeriods: route("bookPeriods", "bookPeriods"),
			monthCloses: route("monthCloses", "monthCloses"),
			wealthTransfers: route("wealthTransfers", "wealthTransfers"),
			payoffPlans: route("payoffPlans", "payoffPlans"),
			transfers: route("transfers", "transfers"),
		},
		currencies: {
			dailyRates: async () => {
				log.push("dailyRates");
				return {
					asOf: null,
					rates: [
						{
							id: "r1",
							currency: "ARS",
							type: "blue",
							date: "2026-10-10T00:00:00.000Z",
							unitsPerUsd: "1500",
						},
					],
				};
			},
		},
	};
}

const FIRST_PULL = [
	"settings",
	"shares(budget=1)",
	...ROUTES.map(([name]) => `${name}(-,500)`),
	"dailyRates",
];

describe("pullAll", () => {
	it("asks settings, shares with the budget block, the 17 entities in order, then the rates", async () => {
		const log: string[] = [];
		const report = await pullAll(new MemoryStore(), fakeApi(log), {});
		expect(log).toEqual(FIRST_PULL);
		expect(Object.keys(report.entities)).toEqual([
			"settings",
			"shares",
			...ROUTES.map(([, entity]) => entity),
			"rates",
		]);
	});

	it("puts what the server sent in the store", async () => {
		const store = new MemoryStore();
		await pullAll(
			store,
			fakeApi([], {
				expenses: [
					{
						items: [expense("e1"), expense("e2", "5.25")],
						tombstones: [],
						cursor: "x",
						hasMore: false,
					},
				],
			}),
			{},
		);
		expect(store.get("settings", "user")?.homeCurrency).toBe("ARS");
		expect(store.list("expenses").map((e) => [e.id, e.amount])).toEqual([
			["e1", "1000"],
			["e2", "5.25"],
		]);
		expect(store.list("rates").map((r) => [r.currency, r.rate])).toEqual([
			["ARS", "1500"],
		]);
	});

	// Two pages of expenses (cursor a, then b): the second asks since a, and
	// the next pull asks since b. Every other entity ended at "<route>-0".
	it("pages an entity to its end and asks the next pull from the last cursor", async () => {
		const store = new MemoryStore();
		const cursors: PullCursors = {};
		const log: string[] = [];
		const first = await pullAll(
			store,
			fakeApi(log, {
				expenses: [
					{
						items: [expense("e1")],
						tombstones: [],
						cursor: "a",
						hasMore: true,
					},
					{
						items: [expense("e2")],
						tombstones: [],
						cursor: "b",
						hasMore: false,
					},
				],
			}),
			cursors,
		);
		expect(log.filter((l) => l.startsWith("expenses"))).toEqual([
			"expenses(-,500)",
			"expenses(a,500)",
		]);
		expect(first.entities.expenses).toMatchObject({ pages: 2, rows: 2 });
		expect(cursors.expenses).toBe("b");
		expect(cursors.categories).toBe("categories-0");

		const again: string[] = [];
		await pullAll(store, fakeApi(again), cursors);
		expect(again).toEqual([
			"settings",
			"shares(budget=1)",
			...ROUTES.map(([name, entity]) =>
				entity === "expenses" ? "expenses(b,500)" : `${name}(${name}-0,500)`,
			),
			"dailyRates",
		]);
	});

	// e1 is deleted and e2 changes from 1000 to 6 in the delta.
	it("applies a delta: a changed row replaces its old one and a tombstone deletes", async () => {
		const store = new MemoryStore();
		const cursors: PullCursors = {};
		await pullAll(
			store,
			fakeApi([], {
				expenses: [
					{
						items: [expense("e1"), expense("e2")],
						tombstones: [],
						cursor: "a",
						hasMore: false,
					},
				],
			}),
			cursors,
		);
		await pullAll(
			store,
			fakeApi([], {
				expenses: [
					{
						items: [expense("e2", "6")],
						tombstones: [{ id: "e1" }],
						cursor: "b",
						hasMore: false,
					},
				],
			}),
			cursors,
		);
		expect(store.list("expenses").map((e) => [e.id, e.amount])).toEqual([
			["e2", "6"],
		]);
	});

	it("stops at a failing page, keeping the cursors of what it finished", async () => {
		const store = new MemoryStore();
		const cursors: PullCursors = {};
		const log: string[] = [];
		await expect(
			pullAll(store, fakeApi(log, {}, { fail: "expenses" }), cursors),
		).rejects.toThrow("expenses is down");
		expect(cursors).toEqual({
			categories: "categories-0",
			recurringTemplates: "recurringTemplates-0",
		});
		expect(log.at(-1)).toBe("expenses(-,500)");
		expect(log).not.toContain("dailyRates");
	});

	it("asks an entity again from the same cursor while the caller says it has not caught up", async () => {
		const log: string[] = [];
		let asked = 0;
		await pullAll(
			new MemoryStore(),
			fakeApi(log),
			{},
			{
				caughtUp: (entity, held) => {
					if (entity !== "expenses") return true;
					expect(held).toBe(0);
					asked += 1;
					return asked > 1;
				},
			},
		);
		expect(log.filter((l) => l.startsWith("expenses"))).toEqual([
			"expenses(-,500)",
			"expenses(expenses-0,500)",
		]);
	});

	it("leaves the shares snapshot and the promotion out when asked to", async () => {
		const log: string[] = [];
		const report = await pullAll(
			new MemoryStore(),
			fakeApi(log),
			{},
			{ shares: false },
		);
		expect(log).not.toContain("shares(budget=1)");
		expect(report.promotion).toBeUndefined();
	});

	it("times each step with the clock it is given", async () => {
		let t = 0;
		const report = await pullAll(
			new MemoryStore(),
			fakeApi([]),
			{},
			{ now: () => (t += 10) },
		);
		// Settings reads the clock before the request, after it and after the write.
		expect(report.entities.settings).toMatchObject({
			fetchMs: 10,
			applyMs: 10,
		});
	});
});

describe("the budget block's promotion", () => {
	// A block waiting at position 100 of epoch e1, made for a book that
	// started 2026-03-01 in ARS and has no later periods.
	const KEY = JSON.stringify([
		"ARS",
		"America/Argentina/Buenos_Aires",
		"2026-03-01T03:00:00.000Z",
		[],
	]);
	const waiting = () =>
		new MemoryStore({
			rows: {
				budgetSnapshotPending: [
					{
						...fixtureRow("budgetSnapshotPending", BUDGET_SNAPSHOT_ID),
						bookId: "book-1",
						valuationKey: KEY,
						asOf: cursor("e1", "100"),
					},
				],
			},
		});
	const book = {
		id: "book-1",
		currency: "ARS",
		style: "FLEX",
		fundingSource: "INCOME",
		pausedAt: null,
		weekStartDay: 1,
		timeZone: "America/Argentina/Buenos_Aires",
		startDate: "2026-03-01T03:00:00.000Z",
		startMonth: 202603,
		defaultEnvelopeId: null,
		startingBalanceExpenseId: null,
	} as WireOf["budgetBooks"];
	/** Every entity ends at `at`, and the book is among the rows. */
	const catchUp = (at: string): Pages => {
		const empty = { items: [], tombstones: [], cursor: at, hasMore: false };
		return {
			...Object.fromEntries(ROUTES.map(([, entity]) => [entity, [empty]])),
			budgetBooks: [{ ...empty, items: [book] }],
		};
	};

	it("waits while a cursor is below the block's position", async () => {
		const store = waiting();
		const report = await pullAll(
			store,
			fakeApi([], catchUp(cursor("e1", "99"))),
			{},
		);
		// 99 is less than 100 as a number, though not as text.
		expect(report.promotion).toEqual({ promoted: false, reason: "cursors" });
		expect(store.get("budgetSnapshot", BUDGET_SNAPSHOT_ID)).toBeUndefined();
	});

	it("moves the block in once every cursor reached it and the book is the one it was made for", async () => {
		const store = waiting();
		const report = await pullAll(
			store,
			fakeApi([], catchUp(cursor("e1", "100"))),
			{},
		);
		expect(report.promotion).toEqual({ promoted: true });
		expect(store.get("budgetSnapshot", BUDGET_SNAPSHOT_ID)?.asOf).toBe(
			cursor("e1", "100"),
		);
		expect(
			store.get("budgetSnapshotPending", BUDGET_SNAPSHOT_ID),
		).toBeUndefined();
	});

	it("says there is nothing to promote when no block was sent", async () => {
		const report = await pullAll(new MemoryStore(), fakeApi([]), {});
		expect(report.promotion).toEqual({ promoted: false, reason: "no-pending" });
	});

	it("pulls the shares alone as it does inside a full pull", async () => {
		const log: string[] = [];
		const store = new MemoryStore();
		const report = await pullShares(store, fakeApi(log));
		expect(log).toEqual(["shares(budget=1)"]);
		expect(report.rows).toBe(0);
		expect(store.get("owed", "owed")).toMatchObject({ owedToYou: 0 });
	});
});
