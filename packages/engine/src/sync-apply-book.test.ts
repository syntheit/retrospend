/**
 * The budget book family in the sync apply layer, on hand-built wire pages:
 * the nine book tables and transfers, the budget snapshot that rides on the
 * shares snapshot, and the refusals that leave a store as it was. Dates are
 * Ana's, home ARS in Buenos Aires, March 2026.
 */
import type { SplitBlock } from "@retrospend/domain/envelope/split-block";
import { describe, expect, it } from "vitest";
import { promotePendingBudget } from "./budget-snapshot";
import { MemoryStore } from "./memory-store";
import { BUDGET_SNAPSHOT_ID, InvalidInputError, OWED_ID } from "./port";
import {
	applySharesSnapshot,
	applySyncPage,
	type SyncEntity,
	type WireOf,
	type WireShares,
} from "./sync-apply";
import type { WireBudgetBlock } from "./sync-apply-book";

const BOOK = "book-1";

const WIRE: { [E in keyof WireOf]?: WireOf[E] } = {
	budgetBooks: {
		id: BOOK,
		currency: "ARS",
		style: "FLEX",
		fundingSource: "INCOME",
		pausedAt: null,
		weekStartDay: 1,
		timeZone: "America/Argentina/Buenos_Aires",
		startDate: "2026-03-01T03:00:00.000Z",
		startMonth: 202603,
		defaultEnvelopeId: "env-1",
		startingBalanceExpenseId: "x-start",
	},
	envelopeGroups: {
		id: "grp-1",
		bookId: BOOK,
		name: "Bills",
		sortOrder: 2,
		role: "BILLS",
		targetKind: "PERCENT_OF_INCOME",
		targetValue: "30.5",
		mainEnvelopeId: null,
		archivedAt: "2026-03-20T00:00:00.000Z",
	},
	envelopes: {
		id: "env-1",
		bookId: BOOK,
		groupId: "grp-1",
		name: "Rent",
		icon: "home",
		color: "blue",
		kind: "STANDARD",
		sortOrder: 0,
		targetAmount: "300000.50",
		targetMode: "REFILL",
		targetCadence: "MONTH",
		targetMonthlyAmount: "25000",
		targetCurrency: "USD",
		targetDueDate: "2026-04-01T00:00:00.000Z",
		targetRepeat: "MONTHLY",
		targetStartMonth: 202604,
		targetTemplateId: "t1",
		targetLiabilityId: "a-card",
		leftoverRule: "CARRY",
		leftoverSweepToId: "env-2",
		wealthAccountId: "a-save",
		wealthDedicated: true,
		archivedAt: null,
	},
	envelopeCategories: {
		id: "ec-1",
		bookId: BOOK,
		envelopeId: "env-1",
		categoryId: "c1",
	},
	budgetMovements: {
		id: "m1",
		bookId: BOOK,
		month: 202603,
		fromEnvelopeId: null,
		toEnvelopeId: "env-1",
		amount: "1200.25",
	},
	bookPeriods: {
		id: "bp-1",
		bookId: BOOK,
		fromMonth: 202603,
		startDay: 5,
		rateType: "blue",
	},
	monthCloses: {
		id: "mc-1",
		bookId: BOOK,
		month: 202603,
		summary: {
			envelopes: [{ id: "env-1", rule: "CARRY", sweepToId: null }],
			links: { c1: "env-1" },
			totals: { spent: 1 },
		},
	},
	wealthTransfers: {
		id: "wt-1",
		bookId: BOOK,
		direction: "TO_WEALTH",
		envelopeId: null,
		date: "2026-03-10T00:00:00.000Z",
		amount: "5000",
	},
	payoffPlans: {
		id: "pp-1",
		bookId: BOOK,
		strategy: "CUSTOM",
		extraMonthly: "10000",
		customOrder: ["a-card", "a-loan"],
		envelopeId: "env-1",
	},
	transfers: {
		id: "tr-1",
		date: "2026-03-12T00:00:00.000Z",
		toAccountId: "a-card",
		toAmount: "20000",
		toCurrency: "ARS",
		feeExpenseId: "x-fee",
	},
};

const wire = <E extends SyncEntity>(entity: E, o: Partial<WireOf[E]> = {}) =>
	({ ...WIRE[entity], ...o }) as WireOf[E];

const none = { tombstones: [] };

const BOOK_ENTITIES = [
	"budgetBooks",
	"envelopeGroups",
	"envelopes",
	"envelopeCategories",
	"budgetMovements",
	"bookPeriods",
	"monthCloses",
	"wealthTransfers",
	"payoffPlans",
	"transfers",
] as const satisfies readonly SyncEntity[];

describe("applySyncPage, the book family", () => {
	it("keeps each wire row as a port row: decimals as text, instants as dates", async () => {
		const store = new MemoryStore();
		await store.transaction((tx) => {
			for (const entity of BOOK_ENTITIES)
				applySyncPage(tx, entity, { items: [wire(entity)], ...none } as never);
		});
		expect(store.get("budgetBooks", BOOK)).toEqual({
			id: BOOK,
			currency: "ARS",
			style: "FLEX",
			fundingSource: "INCOME",
			pausedAt: null,
			weekStartDay: 1,
			timeZone: "America/Argentina/Buenos_Aires",
			startDate: new Date("2026-03-01T03:00:00.000Z"),
			startMonth: 202603,
			defaultEnvelopeId: "env-1",
			startingBalanceExpenseId: "x-start",
		});
		expect(store.get("envelopeGroups", "grp-1")).toMatchObject({
			targetValue: "30.5",
			archivedAt: new Date("2026-03-20T00:00:00.000Z"),
		});
		expect(store.get("envelopes", "env-1")).toMatchObject({
			targetAmount: "300000.50",
			targetMonthlyAmount: "25000",
			targetDueDate: new Date("2026-04-01T00:00:00.000Z"),
			targetStartMonth: 202604,
			targetLiabilityId: "a-card",
			wealthDedicated: true,
			archivedAt: null,
		});
		expect(store.get("envelopeCategories", "ec-1")).toEqual({
			id: "ec-1",
			bookId: BOOK,
			envelopeId: "env-1",
			categoryId: "c1",
		});
		expect(store.get("budgetMovements", "m1")).toEqual({
			id: "m1",
			bookId: BOOK,
			month: 202603,
			fromEnvelopeId: null,
			toEnvelopeId: "env-1",
			amount: "1200.25",
		});
		expect(store.get("bookPeriods", "bp-1")).toMatchObject({
			fromMonth: 202603,
			startDay: 5,
			rateType: "blue",
		});
		// Only what the loader reads of a summary is kept.
		expect(store.get("monthCloses", "mc-1")?.summary).toEqual({
			envelopes: [{ id: "env-1", rule: "CARRY", sweepToId: null }],
			links: { c1: "env-1" },
		});
		expect(store.get("wealthTransfers", "wt-1")).toMatchObject({
			amount: "5000",
			date: new Date("2026-03-10T00:00:00.000Z"),
			envelopeId: null,
		});
		expect(store.get("payoffPlans", "pp-1")).toMatchObject({
			extraMonthly: "10000",
			customOrder: ["a-card", "a-loan"],
		});
		expect(store.get("transfers", "tr-1")).toEqual({
			id: "tr-1",
			date: new Date("2026-03-12T00:00:00.000Z"),
			toAccountId: "a-card",
			toAmount: "20000",
			toCurrency: "ARS",
			feeExpenseId: "x-fee",
		});
	});

	it("a page applied twice is the same as once, and a tombstone deletes the row", async () => {
		const store = new MemoryStore();
		const page = { items: [wire("budgetMovements")], ...none };
		await store.transaction((tx) => applySyncPage(tx, "budgetMovements", page));
		const once = store.list("budgetMovements");
		await store.transaction((tx) => applySyncPage(tx, "budgetMovements", page));
		expect(store.list("budgetMovements")).toEqual(once);
		await store.transaction((tx) =>
			applySyncPage(tx, "budgetMovements", {
				items: [],
				tombstones: [{ id: "m1" }],
			}),
		);
		expect(store.list("budgetMovements")).toEqual([]);
	});

	it("a book that became shared leaves a store with no book rows once its tombstones apply", async () => {
		const store = new MemoryStore();
		await store.transaction((tx) => {
			applySyncPage(tx, "budgetBooks", {
				items: [wire("budgetBooks")],
				...none,
			});
			applySyncPage(tx, "envelopes", { items: [wire("envelopes")], ...none });
		});
		await store.transaction((tx) => {
			applySyncPage(tx, "budgetBooks", {
				items: [],
				tombstones: [{ id: BOOK }],
			});
			applySyncPage(tx, "envelopes", {
				items: [],
				tombstones: [{ id: "env-1" }],
			});
		});
		expect(store.list("budgetBooks")).toEqual([]);
		expect(store.list("envelopes")).toEqual([]);
	});

	// A bad row refuses the whole page: the good row before it is not written.
	const BAD: ReadonlyArray<[string, SyncEntity, object]> = [
		[
			"a movement amount that is not plain decimal text",
			"budgetMovements",
			{ amount: "1e3" },
		],
		["a movement month of 13", "budgetMovements", { month: 202613 }],
		[
			"a movement month that is not whole",
			"budgetMovements",
			{ month: 202603.5 },
		],
		["a period month of zero", "bookPeriods", { fromMonth: 0 }],
		[
			"a book start month that is a date",
			"budgetBooks",
			{ startMonth: 20260301 },
		],
		[
			"a book start date that is not a date",
			"budgetBooks",
			{ startDate: "March" },
		],
		[
			"an envelope target that is not a decimal",
			"envelopes",
			{ targetAmount: "12,5" },
		],
		[
			"an envelope due date that is not a date",
			"envelopes",
			{ targetDueDate: "soon" },
		],
		[
			"an envelope target start month of 202600",
			"envelopes",
			{ targetStartMonth: 202600 },
		],
		[
			"a group target that is not a decimal",
			"envelopeGroups",
			{ targetValue: "x" },
		],
		[
			"a Wealth move amount that is not a decimal",
			"wealthTransfers",
			{ amount: "" },
		],
		["a Wealth move date that is not a date", "wealthTransfers", { date: "x" }],
		[
			"a payoff extra that is not a decimal",
			"payoffPlans",
			{ extraMonthly: "-" },
		],
		[
			"a custom order that is not a list",
			"payoffPlans",
			{ customOrder: "a-card" },
		],
		[
			"a custom order with a number in it",
			"payoffPlans",
			{ customOrder: ["a", 2] },
		],
		[
			"a transfer amount that is not a decimal",
			"transfers",
			{ toAmount: "NaN" },
		],
		["a transfer date that is not a date", "transfers", { date: "x" }],
		["a close summary that is not an object", "monthCloses", { summary: "{}" }],
		[
			"a close summary without envelopes",
			"monthCloses",
			{ summary: { links: {} } },
		],
		[
			"a close envelope without a rule",
			"monthCloses",
			{ summary: { envelopes: [{ id: "env-1", sweepToId: null }] } },
		],
		[
			"a close envelope sweep that is a number",
			"monthCloses",
			{
				summary: { envelopes: [{ id: "env-1", rule: "CARRY", sweepToId: 1 }] },
			},
		],
		[
			"a close link to a number",
			"monthCloses",
			{ summary: { envelopes: [], links: { c1: 1 } } },
		],
	];
	for (const [name, entity, bad] of BAD)
		it(`refuses a page with ${name} and writes none of it`, async () => {
			const store = new MemoryStore();
			const good = { ...wire(entity), id: "good" };
			await expect(
				store.transaction((tx) =>
					applySyncPage(tx, entity, {
						items: [good, wire(entity, bad as never)],
						...none,
					} as never),
				),
			).rejects.toThrow(InvalidInputError);
			expect(store.list(entity)).toEqual([]);
		});

	it("refuses a page that repeats an id", async () => {
		const store = new MemoryStore();
		await expect(
			store.transaction((tx) =>
				applySyncPage(tx, "envelopes", {
					items: [wire("envelopes"), wire("envelopes")],
					...none,
				}),
			),
		).rejects.toThrow(InvalidInputError);
		expect(store.list("envelopes")).toEqual([]);
	});

	it("keeps a close summary with no links, and a sweep target of null", async () => {
		const store = new MemoryStore();
		await store.transaction((tx) =>
			applySyncPage(tx, "monthCloses", {
				items: [
					wire("monthCloses", {
						summary: {
							envelopes: [{ id: "e", rule: "SWEEP", sweepToId: "x" }],
						},
					}),
				],
				...none,
			}),
		);
		expect(store.get("monthCloses", "mc-1")?.summary).toEqual({
			envelopes: [{ id: "e", rule: "SWEEP", sweepToId: "x" }],
		});
	});
});

describe("expense and account fields the budget reads", () => {
	it("an expense keeps its amortization, Wealth, template and envelope fields", async () => {
		const store = new MemoryStore();
		await store.transaction((tx) =>
			applySyncPage(tx, "expenses", {
				items: [
					{
						id: "e1",
						title: "Fridge",
						amount: "600000",
						currency: "ARS",
						date: "2026-03-05T15:00:00.000Z",
						categoryId: null,
						amountInUSD: "400",
						exchangeRate: "1500",
						pricingSource: "MANUAL",
						location: null,
						description: null,
						status: "FINALIZED",
						isAmortizedParent: false,
						isAmortizedChild: true,
						parentId: "e0",
						amortizeMode: "INSTALLMENTS",
						keepInWealth: true,
						recurringTemplateId: "t1",
						budgetEnvelopeId: "env-1",
						excludeFromAnalytics: false,
						direction: "OUT",
						entryKind: "STANDARD",
						inType: null,
						rateType: "blue",
						homeCurrency: "ARS",
						homeRate: "1",
						homeAmount: "600000",
					},
				],
				...none,
			}),
		);
		expect(store.get("expenses", "e1")).toMatchObject({
			isAmortizedChild: true,
			parentId: "e0",
			amortizeMode: "INSTALLMENTS",
			keepInWealth: true,
			recurringTemplateId: "t1",
			budgetEnvelopeId: "env-1",
			homeCurrency: "ARS",
			homeAmount: "600000",
		});
	});

	it("an account keeps its terms, and refuses a rate that is not a decimal", async () => {
		const account = {
			id: "a-card",
			type: "CREDIT_CARD",
			currency: "ARS",
			balance: "-150000",
			exchangeRate: null,
			exchangeRateType: null,
			interestRate: "45.9",
			minimumPayment: "15000.50",
			dueDate: 10,
			closedAt: null,
			createdAt: "2026-01-01T00:00:00.000Z",
		} as const;
		const store = new MemoryStore();
		await store.transaction((tx) =>
			applySyncPage(tx, "accounts", {
				items: [account as never],
				...none,
			}),
		);
		expect(store.get("accounts", "a-card")).toMatchObject({
			interestRate: "45.9",
			minimumPayment: "15000.50",
			dueDate: 10,
		});
		await expect(
			store.transaction((tx) =>
				applySyncPage(tx, "accounts", {
					items: [{ ...account, id: "a2", interestRate: "45,9" } as never],
					...none,
				}),
			),
		).rejects.toThrow(InvalidInputError);
		expect(store.get("accounts", "a2")).toBeUndefined();
	});
});

const EMPTY_SPLITS: SplitBlock = {
	shares: [],
	effects: [],
	balances: [],
	ignored: [],
	events: [],
	pending: [],
	unresolved: [],
	notInBudget: [],
	missingRates: [],
	approximate: [],
	checkpointMissingRates: [],
	checkpointApproximate: [],
};

const block = (o: Partial<WireBudgetBlock> = {}): WireBudgetBlock => ({
	bookId: BOOK,
	valuationKey: "ARS|America/Argentina/Buenos_Aires|2026-03-01|202603:5:blue",
	asOf: "cursor-1",
	frozen: [
		{
			key: "e1|ARS|1000|0.67|2026-03-05|blue",
			minor: 100_000,
			approximate: false,
		},
		{
			key: "e2|USD|10|10|2026-03-06|blue",
			minor: 1_500_000,
			approximate: true,
		},
	],
	splits: {
		...EMPTY_SPLITS,
		notInBudget: ["project-1"],
		unresolved: ["share-9"],
	},
	...o,
});

/** A block with something in every list the check reads, one event of each kind. */
const rich = (): WireBudgetBlock => {
	const base = {
		counterparty: "p1",
		currency: "USD",
		date: "2026-03-05",
		month: 202603,
		native: 1000,
	};
	return block({
		splits: {
			shares: [
				{
					id: "part-1",
					month: 202603,
					date: "2026-03-06",
					minor: -75_000,
					source: "SHARE",
					categoryId: "c1",
					envelopeId: null,
					pending: true,
				},
			],
			effects: [
				{
					eventId: "e1",
					date: "2026-03-05",
					month: 202603,
					counterparty: "p1",
					currency: "USD",
					term: "FRONTED",
					minor: 150_000,
					fx: 0,
					envelopeId: null,
				},
			],
			balances: [
				{
					counterparty: "p1",
					currency: "USD",
					native: 1000,
					basis: 150_000,
					oldestOpen: "2026-03-05",
				},
				{
					counterparty: "p2",
					currency: "USD",
					native: -500,
					basis: 0,
					oldestOpen: null,
				},
			],
			ignored: [{ eventId: "e9", reason: "NOT_IN_BUDGET", native: 700 }],
			events: [
				{
					...base,
					id: "e1",
					kind: "FRONT",
					value: 150_000,
					shareStatus: "ACCEPTED",
				},
				{ ...base, id: "e2", kind: "OWE", status: "ACCEPTED" },
				{ ...base, id: "e3", kind: "UNFRONT" },
				{
					...base,
					id: "e4",
					kind: "RECV",
					status: "FINALIZED",
					cash: 160_000,
					isOffset: false,
				},
				{
					...base,
					id: "e5",
					kind: "PAY",
					status: "PROPOSED",
					cash: 20_000,
					forgiven: true,
				},
				{
					...base,
					id: "e6",
					kind: "FORGIVE",
					status: "FINALIZED",
					envelopeId: "env-1",
					notInBudget: true,
				},
			],
			pending: [
				{
					id: "e7",
					counterparty: "p1",
					currency: "USD",
					native: 500,
					cash: null,
					date: "2026-03-09",
				},
				{
					id: "e8",
					counterparty: "p1",
					currency: "USD",
					native: 500,
					cash: 75_000,
					date: "2026-03-09",
				},
			],
			unresolved: ["share-9"],
			notInBudget: ["project-1"],
			missingRates: [
				{ currency: "XQZ", rateType: null, date: "2026-03-05", rowId: "e1" },
			],
			approximate: [{ rowId: "e2", date: "2026-03-05" }],
			checkpointMissingRates: [
				{ currency: "XQZ", rateType: "blue", date: "2026-02-05" },
			],
			checkpointApproximate: [{ rowId: "e3", date: "2026-02-05" }],
		},
	});
};

const shares = (
	budget?: WireShares["budget"],
	youOwe = 100_000,
): WireShares => ({
	items: [],
	owed: {
		owedToYou: { minor: 250_000, currency: "ARS" },
		youOwe: { minor: youOwe, currency: "ARS" },
	},
	...(budget === undefined ? {} : { budget }),
});

const pull = (store: MemoryStore, body: WireShares) =>
	store.transaction((tx) => applySharesSnapshot(tx, body));

/** The cursor of the active and the pending snapshot, undefined for none. */
const held = (store: MemoryStore) => ({
	active: store.get("budgetSnapshot", BUDGET_SNAPSHOT_ID)?.asOf,
	pending: store.get("budgetSnapshotPending", BUDGET_SNAPSHOT_ID)?.asOf,
});

describe("applySharesSnapshot, the budget snapshot", () => {
	it("a block lands as pending beside the owed row, and the active snapshot is untouched", async () => {
		const store = new MemoryStore();
		await pull(store, shares(block()));
		expect(held(store)).toEqual({ active: undefined, pending: "cursor-1" });
		expect(store.get("budgetSnapshotPending", BUDGET_SNAPSHOT_ID)).toEqual({
			id: BUDGET_SNAPSHOT_ID,
			...block(),
		});
		expect(store.get("owed", OWED_ID)).toMatchObject({
			owedToYou: 250_000,
			youOwe: 100_000,
		});
	});

	it("promoting moves pending to active, empties pending and says so once", async () => {
		const store = new MemoryStore();
		await pull(store, shares(block()));
		expect(await store.transaction((tx) => promotePendingBudget(tx))).toBe(
			true,
		);
		expect(held(store)).toEqual({ active: "cursor-1", pending: undefined });
		expect(store.get("budgetSnapshot", BUDGET_SNAPSHOT_ID)).toEqual({
			id: BUDGET_SNAPSHOT_ID,
			...block(),
		});
		expect(await store.transaction((tx) => promotePendingBudget(tx))).toBe(
			false,
		);
		expect(held(store)).toEqual({ active: "cursor-1", pending: undefined });
	});

	it("promoting with nothing pending changes nothing, active included", async () => {
		const store = new MemoryStore();
		expect(await store.transaction((tx) => promotePendingBudget(tx))).toBe(
			false,
		);
		expect(held(store)).toEqual({ active: undefined, pending: undefined });
	});

	it("a promote that is rolled back leaves both snapshots as they were", async () => {
		const store = new MemoryStore();
		await pull(store, shares(block()));
		await expect(
			store.transaction((tx) => {
				promotePendingBudget(tx);
				throw new Error("later step failed");
			}),
		).rejects.toThrow("later step failed");
		expect(held(store)).toEqual({ active: undefined, pending: "cursor-1" });
	});

	it("a newer block replaces pending while the active block keeps serving, until it is promoted", async () => {
		const store = new MemoryStore();
		await pull(store, shares(block()));
		await store.transaction((tx) => promotePendingBudget(tx));
		await pull(
			store,
			shares(
				block({
					asOf: "cursor-2",
					frozen: [
						{
							key: "e3|ARS|5|0|2026-03-07|blue",
							minor: 500,
							approximate: false,
						},
					],
				}),
			),
		);
		expect(held(store)).toEqual({ active: "cursor-1", pending: "cursor-2" });
		expect(
			store
				.get("budgetSnapshot", BUDGET_SNAPSHOT_ID)
				?.frozen.map((f) => f.minor),
		).toEqual([100_000, 1_500_000]);
		// A third block before the second passed its gate replaces the second.
		await pull(store, shares(block({ asOf: "cursor-3" })));
		expect(held(store)).toEqual({ active: "cursor-1", pending: "cursor-3" });
		await store.transaction((tx) => promotePendingBudget(tx));
		expect(held(store)).toEqual({ active: "cursor-3", pending: undefined });
	});

	it("a throw after the apply rolls pending and the owed row back together", async () => {
		const store = new MemoryStore();
		await pull(store, shares(block()));
		await expect(
			store.transaction((tx) => {
				applySharesSnapshot(tx, shares(block({ asOf: "cursor-2" }), 777_000));
				throw new Error("later step failed");
			}),
		).rejects.toThrow("later step failed");
		expect(held(store)).toEqual({ active: undefined, pending: "cursor-1" });
		expect(store.get("owed", OWED_ID)).toMatchObject({ youOwe: 100_000 });
	});

	it("unavailable keeps both snapshots while the shares and owed totals still apply", async () => {
		const store = new MemoryStore();
		await pull(store, shares(block()));
		await store.transaction((tx) => promotePendingBudget(tx));
		await pull(store, shares(block({ asOf: "cursor-2" })));
		await pull(store, shares({ unavailable: true }, 300_000));
		expect(held(store)).toEqual({ active: "cursor-1", pending: "cursor-2" });
		expect(store.get("owed", OWED_ID)).toMatchObject({ youOwe: 300_000 });
	});

	it("unavailable with nothing held leaves nothing", async () => {
		const store = new MemoryStore();
		await pull(store, shares({ unavailable: true }));
		expect(held(store)).toEqual({ active: undefined, pending: undefined });
	});

	it("null clears both snapshots: nothing to read on a device", async () => {
		const store = new MemoryStore();
		await pull(store, shares(block()));
		await store.transaction((tx) => promotePendingBudget(tx));
		await pull(store, shares(block({ asOf: "cursor-2" })));
		expect(held(store)).toEqual({ active: "cursor-1", pending: "cursor-2" });
		await pull(store, shares(null));
		expect(held(store)).toEqual({ active: undefined, pending: undefined });
	});

	it("a body without the field was not asked for it and leaves both", async () => {
		const store = new MemoryStore();
		await pull(store, shares(block()));
		await store.transaction((tx) => promotePendingBudget(tx));
		await pull(store, shares(block({ asOf: "cursor-2" })));
		await pull(store, shares());
		expect(held(store)).toEqual({ active: "cursor-1", pending: "cursor-2" });
	});

	it("accepts a block with something in every list, one event of each kind", async () => {
		const store = new MemoryStore();
		const body = rich();
		await pull(store, shares(body));
		expect(store.get("budgetSnapshotPending", BUDGET_SNAPSHOT_ID)).toEqual({
			id: BUDGET_SNAPSHOT_ID,
			...body,
		});
	});

	const REMOVE = Symbol("remove");
	type Fault = readonly [string, readonly (string | number)[], unknown];
	const BAD_BLOCKS: readonly Fault[] = [
		["an asOf that is a number", ["asOf"], 5],
		["an empty asOf", ["asOf"], ""],
		["no asOf", ["asOf"], REMOVE],
		["an empty book id", ["bookId"], ""],
		["a book id that is a number", ["bookId"], 7],
		["a valuation key that is a number", ["valuationKey"], 1],
		["frozen that is not a list", ["frozen"], {}],
		["a frozen key that is a number", ["frozen", 0, "key"], 1],
		["a frozen approximate that is text", ["frozen", 0, "approximate"], "no"],
		[
			"a repeated frozen key",
			["frozen", 1, "key"],
			"e1|ARS|1000|0.67|2026-03-05|blue",
		],
		["a fractional frozen value", ["frozen", 0, "minor"], 1.5],
		["a frozen value past the safe integers", ["frozen", 0, "minor"], 2 ** 53],
		["splits that are not an object", ["splits"], "none"],
		["a splits list that is missing", ["splits", "balances"], REMOVE],
		["a fractional split share", ["splits", "shares", 0, "minor"], -0.5],
		[
			"a split share on a date that does not exist",
			["splits", "shares", 0, "date"],
			"2026-02-30",
		],
		["a split share in month 13", ["splits", "shares", 0, "month"], 202613],
		["a split share id that is a number", ["splits", "shares", 0, "id"], 4],
		[
			"a split share envelope that is a number",
			["splits", "shares", 0, "envelopeId"],
			4,
		],
		["a fractional effect fx", ["splits", "effects", 0, "fx"], 0.5],
		["an effect on a bad date", ["splits", "effects", 0, "date"], "x"],
		[
			"an effect minor that is text",
			["splits", "effects", 0, "minor"],
			"150000",
		],
		[
			"a balance past the safe integers",
			["splits", "balances", 0, "native"],
			1e21,
		],
		[
			"a balance basis that is fractional",
			["splits", "balances", 0, "basis"],
			1.5,
		],
		[
			"a balance oldest open that is not a date",
			["splits", "balances", 0, "oldestOpen"],
			"March",
		],
		[
			"an ignored amount that is fractional",
			["splits", "ignored", 0, "native"],
			0.1,
		],
		["an event of no known kind", ["splits", "events", 0, "kind"], "WAT"],
		["a fractional FRONT value", ["splits", "events", 0, "value"], 1.5],
		["a RECV cash that is text", ["splits", "events", 3, "cash"], "5"],
		[
			"a PAY cash past the safe integers",
			["splits", "events", 4, "cash"],
			2 ** 53,
		],
		[
			"a FORGIVE envelope that is a number",
			["splits", "events", 5, "envelopeId"],
			1,
		],
		[
			"an event native that is fractional",
			["splits", "events", 1, "native"],
			0.5,
		],
		["an event in month zero", ["splits", "events", 1, "month"], 0],
		["an event on a bad date", ["splits", "events", 2, "date"], "2026-13-01"],
		[
			"an event notInBudget that is text",
			["splits", "events", 5, "notInBudget"],
			"yes",
		],
		[
			"a pending receipt cash that is fractional",
			["splits", "pending", 1, "cash"],
			1.5,
		],
		[
			"a pending receipt on a bad date",
			["splits", "pending", 0, "date"],
			"9 March",
		],
		[
			"a missing rate on a bad date",
			["splits", "missingRates", 0, "date"],
			"x",
		],
		[
			"a missing rate currency that is a number",
			["splits", "missingRates", 0, "currency"],
			1,
		],
		[
			"an approximate row id that is a number",
			["splits", "approximate", 0, "rowId"],
			2,
		],
		[
			"a checkpoint missing rate on a bad date",
			["splits", "checkpointMissingRates", 0, "date"],
			"x",
		],
		[
			"a checkpoint approximate row on a bad date",
			["splits", "checkpointApproximate", 0, "date"],
			"2026-02-31",
		],
		["an unresolved id that is a number", ["splits", "unresolved", 0], 3],
		[
			"a not-in-budget project that is a number",
			["splits", "notInBudget", 0],
			3,
		],
	];

	/** Sets the value at `path` of a plain document, or removes it. */
	function poke(
		doc: unknown,
		path: readonly (string | number)[],
		value: unknown,
	) {
		let at = doc as Record<string | number, unknown>;
		for (const key of path.slice(0, -1))
			at = at[key] as Record<string | number, unknown>;
		const last = path[path.length - 1] as string | number;
		if (value === REMOVE) delete at[last];
		else at[last] = value;
	}

	const SHARE_ROW = {
		id: "s1",
		expenseId: "x1",
		shareAmount: "250",
		verificationStatus: "ACCEPTED",
		currency: "ARS",
		date: "2026-03-06T15:00:00.000Z",
		projectId: null,
		exchangeRate: null,
		expenseCategoryId: null,
	};

	for (const [name, path, value] of BAD_BLOCKS)
		it(`refuses a body with ${name}, writing nothing`, async () => {
			const store = new MemoryStore();
			await pull(store, { ...shares(block()), items: [SHARE_ROW] });
			await store.transaction((tx) => promotePendingBudget(tx));
			await pull(store, shares(block({ asOf: "cursor-2" })));
			const bad: WireBudgetBlock = JSON.parse(JSON.stringify(rich()));
			poke(bad, path, value);
			await expect(pull(store, shares(bad, 999_000))).rejects.toThrow(
				InvalidInputError,
			);
			expect(store.list("shares")).toEqual([]);
			expect(held(store)).toEqual({ active: "cursor-1", pending: "cursor-2" });
			expect(store.get("owed", OWED_ID)).toMatchObject({ youOwe: 100_000 });
		});

	it("refuses a budget field that is not an object, writing nothing", async () => {
		const store = new MemoryStore();
		await pull(store, shares(block()));
		await expect(
			pull(store, shares("block" as never, 999_000)),
		).rejects.toThrow(InvalidInputError);
		await expect(pull(store, shares(0 as never, 999_000))).rejects.toThrow(
			InvalidInputError,
		);
		expect(held(store).pending).toBe("cursor-1");
		expect(store.get("owed", OWED_ID)).toMatchObject({ youOwe: 100_000 });
	});

	it("the snapshot is a copy: changing the body afterwards changes nothing", async () => {
		const store = new MemoryStore();
		const body = block();
		await pull(store, shares(body));
		(body.splits.notInBudget as string[]).push("project-2");
		(body.frozen as unknown as { minor: number }[])[0] = { minor: 1 };
		const row = store.get("budgetSnapshotPending", BUDGET_SNAPSHOT_ID);
		expect(row?.splits.notInBudget).toEqual(["project-1"]);
		expect(row?.frozen[0]?.minor).toBe(100_000);
	});
});
