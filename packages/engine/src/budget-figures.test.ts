/**
 * The 12 budget figures on a device store, with hand-derived values, and the
 * gate that decides when the budget snapshot may be read.
 *
 * The book: ARS, Buenos Aires (UTC-3), the month starting on the 5th, style
 * SAVE_FIRST, the clock 2026-11-14T15:00Z (budget month 202611, Nov 5 to Dec
 * 4). ARS per USD: blue 1,500 and official 1,000 (the book's period is blue).
 * Rows, all in Dining unless said, dated Nov 6 to 10 (local days):
 *   starting money ARS 1,000,000.00
 *   ARS 30,000.00                           30,000.00 as entered
 *   USD 10 booked at ARS 14,500.00          14,500.00 as booked
 *   USD 10 with no booked value             frozen by the server at blue 1,400
 *                                           = 14,000.00 (the table says 1,500:
 *                                           the kept value is what counts)
 *   refund ARS 2,000.00                     -2,000.00
 *   income ARS 150,000.00 (no category)
 *   your USD 30 of a split Bob paid         from the block: 45,000.00 spent
 *   Dining assigned 300,000.00
 * and a USD 1,000 card.
 *   Dining spent = 30,000 + 14,500 + 14,000 - 2,000 + 45,000     = 101,500.00
 *   Dining left  = 300,000 - 101,500                              = 198,500.00
 *   Money in                                                      = 150,000.00
 *   Not planned yet = (1,000,000 + 150,000) - 300,000             = 850,000.00
 *   Left to spend = Dining 198,500 + default 0 (the pool is positive)
 *   Holds = 850,000 + 198,500 + Rent 0                            = 1,048,500.00
 *     (= 1,150,000 - 101,500)
 *   Held for others: the block holds no debt                      = 0.00
 *   Plan cost = Rent 100,000 + Dining 250,000                     = 350,000.00
 *   Typical income: the book began this month                     = unavailable
 *   Total debt = USD 1,000 at blue 1,500                          = 1,500,000.00
 */

import { createBudgetFigures } from "@retrospend/domain/envelope/figures";
import { FigurePass, readFiguresIn } from "@retrospend/domain/figures/registry";
import { describe, expect, it } from "vitest";
import {
	BUDGET_FIGURE_IDS,
	deviceBudgetReads,
	deviceMonthView,
} from "./budget-figures";
import {
	BUDGET_GATE_ENTITIES,
	budgetGate,
	budgetStatus,
	cursorPosition,
	dropBudgetOnReset,
	type EntityCursors,
	promoteBudgetIfReady,
	SYNC_RESET,
} from "./budget-gate";
import { fixtureRow } from "./fixtures";
import { MemoryStore } from "./memory-store";
import type { Reader, TableName, TableRows } from "./port";
import { deviceFigures } from "./registry";

const at = (iso: string) => new Date(iso);
const NOW = at("2026-11-14T15:00:00Z");
const ZONE = "America/Argentina/Buenos_Aires";
const scope = { userId: "u1" };
const money = (minor: number) => [{ minor, currency: "ARS" }];

type Rows = { [T in TableName]: TableRows[T][] };

const empty = (): Rows => ({
	bookPeriods: [],
	budgetBooks: [],
	budgetReset: [],
	budgetMovements: [],
	budgetSnapshot: [],
	budgetSnapshotPending: [],
	envelopeCategories: [],
	envelopeGroups: [],
	envelopes: [],
	monthCloses: [],
	payoffPlans: [],
	transfers: [],
	wealthTransfers: [],
	categories: [],
	owed: [],
	rateSwitches: [],
	rateSync: [],
	snapshots: [],
	settings: [],
	rates: [],
	expenses: [],
	shares: [],
	accounts: [],
	legs: [],
	recurringTemplates: [],
});

const KEY = JSON.stringify([
	"ARS",
	ZONE,
	"2026-11-05T03:00:00.000Z",
	[[202611, 5, "blue"]],
]);

/** A base64url cursor, {e, t, s} as the server writes it (ASCII only). */
function cursor(e: string, t: string, s = "9") {
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
	const bytes = [...JSON.stringify({ e, t, s })].map((c) => c.charCodeAt(0));
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const [a = 0, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
		const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
		out += alphabet[(n >> 18) & 63];
		out += alphabet[(n >> 12) & 63];
		if (b !== undefined) out += alphabet[(n >> 6) & 63];
		if (c !== undefined) out += alphabet[n & 63];
	}
	return out;
}

const expense = (id: string, o: Partial<TableRows["expenses"]>) => ({
	...fixtureRow("expenses", id),
	categoryId: "cat-dining",
	categoryKind: "EXPENSE",
	amountInUSD: "1",
	homeCurrency: null,
	homeAmount: null,
	...o,
});

const envelope = (
	id: string,
	o: Partial<TableRows["envelopes"]>,
): TableRows["envelopes"] => ({
	...fixtureRow("envelopes", id),
	bookId: "book",
	groupId: "bills",
	kind: "MONTHLY",
	targetAmount: "100000",
	targetMode: "SET_ASIDE",
	...o,
});

const SPLITS = fixtureRow("budgetSnapshot", "budget").splits;

function snapshot(
	o: Partial<TableRows["budgetSnapshot"]> = {},
): TableRows["budgetSnapshot"] {
	return {
		id: "budget",
		bookId: "book",
		valuationKey: KEY,
		asOf: cursor("e1", "100"),
		frozen: [
			{
				key: "unbooked|USD|10|10|2026-11-08|blue",
				minor: 1_400_000,
				approximate: false,
			},
		],
		splits: {
			...SPLITS,
			// Your USD 30 of the split, valued at the book's rate when Bob paid: 45,000.00.
			shares: [
				{
					id: "share-1",
					month: 202611,
					date: "2026-11-10",
					minor: -4_500_000,
					source: "SHARE",
					categoryId: "cat-dining",
				},
			],
		},
		...o,
	};
}

function ledger(o: Partial<Rows> = {}): Rows {
	return {
		...empty(),
		categories: [
			{
				id: "cat-dining",
				kind: "EXPENSE",
				name: "Dining",
				color: "red",
				icon: null,
				excludeByDefault: false,
				version: 0,
			},
		],
		rates: [
			{
				id: "r1",
				currency: "ARS",
				type: "blue",
				rate: "1500",
				date: at("2026-10-01T00:00:00Z"),
			},
			{
				id: "r2",
				currency: "ARS",
				type: "official",
				rate: "1000",
				date: at("2026-10-01T00:00:00Z"),
			},
		],
		budgetBooks: [
			{
				...fixtureRow("budgetBooks", "book"),
				style: "SAVE_FIRST",
				timeZone: ZONE,
				startDate: at("2026-11-05T03:00:00Z"),
				startMonth: 202611,
				defaultEnvelopeId: "spending",
				startingBalanceExpenseId: "start",
			},
		],
		bookPeriods: [
			{
				id: "p1",
				bookId: "book",
				fromMonth: 202611,
				startDay: 5,
				rateType: "blue",
			},
		],
		envelopeGroups: [
			{
				...fixtureRow("envelopeGroups", "bills"),
				bookId: "book",
				targetKind: "NONE",
				targetValue: null,
			},
			{
				...fixtureRow("envelopeGroups", "spending-group"),
				bookId: "book",
				name: "Spending",
				role: "SPENDING",
				sortOrder: 1,
				targetKind: "NONE",
				targetValue: null,
			},
		],
		envelopes: [
			envelope("rent", { name: "Rent" }),
			envelope("dining", {
				name: "Dining",
				groupId: "spending-group",
				targetAmount: "250000",
				targetMode: "REFILL",
				sortOrder: 1,
			}),
			envelope("spending", {
				name: "Spending",
				groupId: "spending-group",
				targetAmount: null,
				sortOrder: 2,
				kind: "MONTHLY",
			}),
		],
		envelopeCategories: [
			{
				id: "l1",
				bookId: "book",
				envelopeId: "dining",
				categoryId: "cat-dining",
			},
		],
		budgetMovements: [
			{
				id: "m1",
				bookId: "book",
				month: 202611,
				fromEnvelopeId: null,
				toEnvelopeId: "dining",
				amount: "300000",
			},
		],
		expenses: [
			expense("start", {
				direction: "IN",
				entryKind: "STARTING_BALANCE",
				categoryId: null,
				categoryKind: null,
				currency: "ARS",
				amount: "1000000",
				homeCurrency: "ARS",
				homeAmount: "1000000",
				date: at("2026-11-05T03:00:00Z"),
			}),
			expense("plain", {
				currency: "ARS",
				amount: "30000",
				homeCurrency: "ARS",
				homeAmount: "30000",
				date: at("2026-11-06T15:00:00Z"),
			}),
			expense("booked", {
				currency: "USD",
				amount: "10",
				amountInUSD: "10",
				homeCurrency: "ARS",
				homeAmount: "14500",
				date: at("2026-11-07T15:00:00Z"),
			}),
			expense("unbooked", {
				currency: "USD",
				amount: "10",
				amountInUSD: "10",
				date: at("2026-11-08T15:00:00Z"),
			}),
			expense("refund", {
				direction: "IN",
				inType: "REFUND",
				currency: "ARS",
				amount: "2000",
				homeCurrency: "ARS",
				homeAmount: "2000",
				date: at("2026-11-09T15:00:00Z"),
			}),
			expense("income", {
				direction: "IN",
				inType: "INCOME",
				categoryId: null,
				categoryKind: null,
				currency: "ARS",
				amount: "150000",
				homeCurrency: "ARS",
				homeAmount: "150000",
				date: at("2026-11-10T15:00:00Z"),
			}),
		],
		accounts: [
			{
				...fixtureRow("accounts", "visa"),
				type: "LIABILITY_CREDIT_CARD",
				currency: "USD",
				balance: "1000",
				exchangeRate: null,
				exchangeRateType: null,
			},
		],
		budgetSnapshot: [snapshot()],
		...o,
	};
}

async function read(
	reader: Reader,
	ids: readonly string[] = BUDGET_FIGURE_IDS,
	narrow: Record<string, string> = { envelopeId: "dining" },
) {
	const registry = deviceFigures({ clock: () => NOW });
	const pass = new FigurePass();
	const readings = await readFiguresIn(
		reader,
		ids.map((id) => registry.get(id)),
		{ ...scope, ...narrow },
		pass,
	);
	return { readings, pass };
}

const NONE = Object.fromEntries(BUDGET_FIGURE_IDS.map((id) => [id, null]));

describe("the budget figures on a device", () => {
	it("registers the ids the shared definitions define", () => {
		const ids = createBudgetFigures(deviceBudgetReads(() => NOW)).map(
			(f) => f.id,
		);
		expect([...BUDGET_FIGURE_IDS].sort()).toEqual([...ids].sort());
	});

	it("reads the twelve figures as derived", async () => {
		const { readings } = await read(new MemoryStore({ rows: ledger() }));
		expect(Object.fromEntries(readings)).toEqual({
			"budget.notPlannedYet": money(85_000_000),
			"budget.leftToSpend": money(19_850_000),
			"budget.leftThisWeek": null,
			"budget.leftInLimits": null,
			"envelope.left": money(19_850_000),
			"envelope.spent": money(10_150_000),
			"budget.moneyIn": money(15_000_000),
			"budget.heldForOthers": money(0),
			"budget.holds": money(104_850_000),
			"budget.planCost": money(35_000_000),
			"budget.typicalIncome": null,
			"budget.totalDebt": money(150_000_000),
		});
	});

	// Left without the frozen value, the unbooked row would read the table's
	// 1,500: the figure takes what the server kept.
	it("values a foreign row at its frozen value, not at today's rate", async () => {
		const frozenAt15 = ledger({
			budgetSnapshot: [
				snapshot({
					frozen: [
						{
							key: "unbooked|USD|10|10|2026-11-08|blue",
							minor: 1_500_000,
							approximate: false,
						},
					],
				}),
			],
		});
		const { readings } = await read(new MemoryStore({ rows: frozenAt15 }), [
			"envelope.spent",
		]);
		expect(readings.get("envelope.spent")).toEqual(money(10_250_000));
	});

	// The envelope variants: Rent (nothing assigned, nothing spent), none, and one that does not exist.
	it("narrows by envelope: each, none and unknown", async () => {
		const store = new MemoryStore({ rows: ledger() });
		const ids = ["envelope.left", "envelope.spent"];
		expect(
			(await read(store, ids, { envelopeId: "rent" })).readings.get(
				"envelope.spent",
			),
		).toEqual(money(0));
		expect(
			(await read(store, ids, { envelopeId: "rent" })).readings.get(
				"envelope.left",
			),
		).toEqual(money(0));
		for (const narrow of [
			{} as Record<string, string>,
			{ envelopeId: "no-such-envelope" },
		]) {
			const { readings } = await read(store, ids, narrow);
			expect(readings.get("envelope.left")).toBeNull();
			expect(readings.get("envelope.spent")).toBeNull();
		}
	});

	it("reads null for a person with no book", async () => {
		const store = new MemoryStore({
			rows: ledger({ budgetBooks: [], budgetSnapshot: [] }),
		});
		expect(budgetStatus(store)).toBe("none");
		const { readings, pass } = await read(store);
		expect(Object.fromEntries(readings)).toEqual(NONE);
		expect(pass.missingRates()).toEqual([]);
	});

	describe("while the budget is stale", () => {
		const stale = (name: string, o: Partial<Rows>) =>
			it(name, async () => {
				const store = new MemoryStore({ rows: ledger(o) });
				expect(budgetStatus(store)).toBe("stale");
				const { readings, pass } = await read(store);
				expect(Object.fromEntries(readings)).toEqual(NONE);
				expect(pass.missingRates()).toEqual([]);
			});

		stale("reads unavailable with no snapshot made yet", {
			budgetSnapshot: [],
		});
		stale("reads unavailable when the book's currency changed since", {
			budgetSnapshot: [
				snapshot({ valuationKey: KEY.replace('"ARS"', '"USD"') }),
			],
		});
		stale("reads unavailable when a period was added since", {
			bookPeriods: [
				{
					id: "p1",
					bookId: "book",
					fromMonth: 202611,
					startDay: 5,
					rateType: "blue",
				},
				{
					id: "p2",
					bookId: "book",
					fromMonth: 202701,
					startDay: 1,
					rateType: "official",
				},
			],
		});
		stale("reads unavailable when the snapshot is for another book", {
			budgetSnapshot: [snapshot({ bookId: "other" })],
		});

		// A waiting block does not serve: only the active snapshot is read.
		it("does not read a pending block", async () => {
			const store = new MemoryStore({
				rows: ledger({
					budgetSnapshot: [],
					budgetSnapshotPending: [{ ...snapshot(), id: "budget" }],
				}),
			});
			expect(budgetStatus(store)).toBe("stale");
			expect((await read(store)).readings.get("envelope.spent")).toBeNull();
		});
	});

	// The server's checkpoint counted this row as missing a rate. The device,
	// which runs from the book's start, keeps it out the same way.
	it("keeps a row the block lists as missing a rate out, and reads unavailable", async () => {
		const withRow = ledger({
			expenses: [
				...ledger().expenses,
				expense("late", {
					currency: "ARS",
					amount: "5000",
					homeCurrency: "ARS",
					homeAmount: "5000",
					date: at("2026-11-11T15:00:00Z"),
				}),
			],
		});
		const without = await read(new MemoryStore({ rows: withRow }), [
			"envelope.spent",
		]);
		// 101,500 + 5,000
		expect(without.readings.get("envelope.spent")).toEqual(money(10_650_000));
		const missing = [
			{
				currency: "ARS",
				rateType: "blue",
				date: "2026-11-11",
				rowId: "late",
			},
		];
		const listing = (o: Partial<TableRows["budgetSnapshot"]["splits"]>) =>
			new MemoryStore({
				rows: ledger({
					expenses: withRow.expenses,
					budgetSnapshot: [
						snapshot({ splits: { ...snapshot().splits, ...o } }),
					],
				}),
			});
		// Both the default read and the plan cost's read left the row out.
		const both = await read(
			listing({
				checkpointMissingRates: missing,
				planCheckpointMissingRates: missing,
			}),
		);
		// The total debt reads the card, not the month: the server keeps it too.
		expect(Object.fromEntries(both.readings)).toEqual({
			...NONE,
			"budget.totalDebt": money(150_000_000),
		});
		// Only the default read did (a later checkpoint made the plan cost's look
		// lack it): the plan cost reads a number, as the server's does, and the
		// month figures stay unavailable.
		const onlyDefault = await read(
			listing({ checkpointMissingRates: missing }),
		);
		expect(onlyDefault.readings.get("budget.planCost")).toEqual(
			money(35_000_000),
		);
		expect(onlyDefault.readings.get("budget.notPlannedYet")).toBeNull();
		// Only the plan cost's look did: the month figures read, the plan cost is unavailable.
		const onlyPlan = await read(
			listing({ planCheckpointMissingRates: missing }),
		);
		expect(onlyPlan.readings.get("budget.planCost")).toBeNull();
		expect(onlyPlan.readings.get("budget.notPlannedYet")).toEqual(
			money(85_000_000),
		);
	});
});

describe("the device's month view", () => {
	const view = (rows: Rows) =>
		deviceMonthView(new MemoryStore({ rows }), "u1", () => NOW);

	// The clock is Nov 14 12:00 in Buenos Aires. Left to spend is the Dining
	// envelope's 198,500.00 (see the top of the file).
	it("answers the server's month read for the current month", async () => {
		const dto = await view(ledger());
		expect(dto?.book.id).toBe("book");
		expect(dto?.book.currency).toBe("ARS");
		expect(dto?.month.key).toBe(202611);
		expect(dto?.today).toBe("2026-11-14");
		expect(dto?.incomplete).toBe(false);
		expect(dto?.approximate).toBe(false);
		expect(dto?.verdict.lead).toEqual({
			kind: "LEFT_TO_SPEND",
			figureId: "budget.leftToSpend",
			amount: { minor: 19_850_000, currency: "ARS" },
		});
	});

	// Every dollar leads with the pool: Not planned yet, 850,000.00.
	it("leads with To assign in an Every dollar book", async () => {
		const [book] = ledger().budgetBooks;
		const dto = await view(
			ledger({
				budgetBooks: book ? [{ ...book, style: "EVERY_DOLLAR" }] : [],
			}),
		);
		expect(dto?.verdict.lead).toEqual({
			kind: "TO_ASSIGN",
			figureId: "budget.notPlannedYet",
			amount: { minor: 85_000_000, currency: "ARS" },
		});
	});

	it("is null with no book and while the budget is stale", async () => {
		expect(
			await view(ledger({ budgetBooks: [], budgetSnapshot: [] })),
		).toBeNull();
		expect(await view(ledger({ budgetSnapshot: [] }))).toBeNull();
	});

	// The figures read unavailable for this month; the view still answers, and says so.
	it("keeps a month with a missing rate, flagged incomplete", async () => {
		const missing = [
			{ currency: "ARS", rateType: "blue", date: "2026-11-11", rowId: "late" },
		];
		const dto = await view(
			ledger({
				budgetSnapshot: [
					snapshot({
						splits: { ...snapshot().splits, checkpointMissingRates: missing },
					}),
				],
			}),
		);
		expect(dto?.incomplete).toBe(true);
	});
});

describe("the gate", () => {
	const pending = {
		bookId: "book",
		valuationKey: KEY,
		asOf: cursor("e1", "100"),
	};
	const book = { id: "book", key: KEY };
	const all = (c: string): EntityCursors =>
		Object.fromEntries(BUDGET_GATE_ENTITIES.map((e) => [e, c]));
	const gate = (
		cursors: EntityCursors,
		o: Partial<Parameters<typeof budgetGate>[0]> = {},
	) => budgetGate({ pending, book, cursors, ...o });

	it("reads the epoch and transaction position of a cursor", () => {
		expect(cursorPosition(cursor("e1", "100"))).toEqual({
			epoch: "e1",
			t: "100",
		});
		expect(cursorPosition("not a cursor")).toBeNull();
		expect(cursorPosition(cursor("", "100"))).toBeNull();
		expect(cursorPosition(cursor("e1", "12x"))).toBeNull();
	});

	it("passes once every cursor has the epoch and a position at or above the block's", () => {
		expect(gate(all(cursor("e1", "100")))).toEqual({ passes: true });
		expect(gate(all(cursor("e1", "1000")))).toEqual({ passes: true });
	});

	it("compares positions as numbers, not as text", () => {
		// "99" is greater than "100" as text, but less as a number.
		expect(gate(all(cursor("e1", "99")))).toEqual({
			passes: false,
			reason: "cursors",
		});
	});

	it("ignores leading zeros and takes the longer number as the larger", () => {
		// 0100 is 100, 099 is 99, and a longer number is larger whatever its digits.
		expect(gate(all(cursor("e1", "0100")))).toEqual({ passes: true });
		expect(gate(all(cursor("e1", "099")))).toEqual({
			passes: false,
			reason: "cursors",
		});
		expect(gate(all(cursor("e1", "00000000000000000100")))).toEqual({
			passes: true,
		});
		expect(gate(all(cursor("e1", "20000000000")))).toEqual({ passes: true });
		const padded = { ...pending, asOf: cursor("e1", "0100") };
		expect(gate(all(cursor("e1", "100")), { pending: padded })).toEqual({
			passes: true,
		});
		expect(gate(all(cursor("e1", "99")), { pending: padded })).toEqual({
			passes: false,
			reason: "cursors",
		});
	});

	for (const entity of BUDGET_GATE_ENTITIES)
		it(`waits for ${entity}`, () => {
			const cursors = all(cursor("e1", "100"));
			delete cursors[entity];
			expect(gate(cursors)).toEqual({ passes: false, reason: "cursors" });
			expect(gate({ ...cursors, [entity]: cursor("e1", "99") })).toEqual({
				passes: false,
				reason: "cursors",
			});
			expect(gate({ ...cursors, [entity]: cursor("e2", "100") })).toEqual({
				passes: false,
				reason: "cursors",
			});
		});

	it("is blocked by a 410 on any entity", () => {
		expect(gate({ ...all(cursor("e1", "100")), accounts: SYNC_RESET })).toEqual(
			{ passes: false, reason: "reset" },
		);
	});

	it("is blocked when the book is not the one the block was made for", () => {
		const cursors = all(cursor("e1", "100"));
		for (const other of [
			null,
			{ id: "book", key: KEY.replace('"ARS"', '"USD"') },
			{ id: "other", key: KEY },
		])
			expect(gate(cursors, { book: other })).toEqual({
				passes: false,
				reason: "key",
			});
	});

	it("never passes a block with a position that is not a cursor", () => {
		expect(
			gate(all(cursor("e1", "100")), {
				pending: { ...pending, asOf: "AAAA" },
			}),
		).toEqual({ passes: false, reason: "malformed" });
	});

	describe("promoting", () => {
		const store = () =>
			new MemoryStore({
				rows: ledger({
					budgetSnapshot: [snapshot({ asOf: cursor("e1", "50") })],
					budgetSnapshotPending: [snapshot({ asOf: cursor("e1", "100") })],
				}),
			});

		it("moves the pending block in when the gate passes, and not before", async () => {
			const s = store();
			const waiting = await s.transaction((tx) =>
				promoteBudgetIfReady(tx, all(cursor("e1", "99"))),
			);
			expect(waiting).toEqual({ promoted: false, reason: "cursors" });
			expect(s.get("budgetSnapshot", "budget")?.asOf).toBe(cursor("e1", "50"));
			const done = await s.transaction((tx) =>
				promoteBudgetIfReady(tx, all(cursor("e1", "100"))),
			);
			expect(done).toEqual({ promoted: true });
			expect(s.get("budgetSnapshot", "budget")?.asOf).toBe(cursor("e1", "100"));
			expect(s.get("budgetSnapshotPending", "budget")).toBeUndefined();
		});

		it("keeps the last block reading while a newer one waits", async () => {
			const s = store();
			expect(budgetStatus(s)).toBe("ready");
			expect(
				(await read(s, ["envelope.spent"])).readings.get("envelope.spent"),
			).toEqual(money(10_150_000));
		});

		it("does nothing with no pending block", async () => {
			const s = new MemoryStore({ rows: ledger() });
			expect(
				await s.transaction((tx) =>
					promoteBudgetIfReady(tx, all(cursor("e1", "100"))),
				),
			).toEqual({ promoted: false, reason: "no-pending" });
		});

		// A 410 dropped the rows the snapshot was made for: unavailable (stale),
		// not "no book", until the re-pull ends and the pending block passes.
		it("reads unavailable after a reset until the re-pulled block passes", async () => {
			const s = store();
			expect(
				await s.transaction((tx) => dropBudgetOnReset(tx, "expenses")),
			).toBe(true);
			expect(budgetStatus(s)).toBe("stale");
			expect(
				(await read(s, ["envelope.spent"])).readings.get("envelope.spent"),
			).toBeNull();
			await s.transaction((tx) =>
				promoteBudgetIfReady(tx, all(cursor("e1", "100"))),
			);
			expect(budgetStatus(s)).toBe("ready");
			expect(
				(await read(s, ["envelope.spent"])).readings.get("envelope.spent"),
			).toEqual(money(10_150_000));
		});

		// The book itself answered 410: its rows go with the reset, so a device that
		// went by its rows would look like a person with no budget (null, as Just
		// track reads). The flag keeps it unavailable until the re-pull passes.
		it("reads unavailable, not none, after a 410 on the book mid re-pull", async () => {
			const s = store();
			await s.transaction((tx) => {
				for (const b of tx.list("budgetBooks")) tx.delete("budgetBooks", b.id);
				dropBudgetOnReset(tx, "budgetBooks");
			});
			expect(s.list("budgetBooks")).toEqual([]);
			expect(budgetStatus(s)).toBe("stale");
			const { readings, pass } = await read(s);
			expect(Object.fromEntries(readings)).toEqual(NONE);
			expect(pass.missingRates()).toEqual([]);
			// The re-pull brings the book back; the figures wait for the gate.
			await s.transaction((tx) =>
				tx.put(
					"budgetBooks",
					ledger().budgetBooks[0] as TableRows["budgetBooks"],
				),
			);
			expect(budgetStatus(s)).toBe("stale");
			await s.transaction((tx) =>
				promoteBudgetIfReady(tx, all(cursor("e1", "99"))),
			);
			expect(budgetStatus(s)).toBe("stale");
			expect(
				await s.transaction((tx) =>
					promoteBudgetIfReady(tx, all(cursor("e1", "100"))),
				),
			).toEqual({ promoted: true });
			expect(s.get("budgetReset", "budget")).toBeUndefined();
			expect(budgetStatus(s)).toBe("ready");
			expect(
				(await read(s, ["envelope.spent"])).readings.get("envelope.spent"),
			).toEqual(money(10_150_000));
		});

		it("ignores a reset of an entity the budget does not read", async () => {
			const s = store();
			expect(await s.transaction((tx) => dropBudgetOnReset(tx, "legs"))).toBe(
				false,
			);
			expect(budgetStatus(s)).toBe("ready");
		});
	});
});
