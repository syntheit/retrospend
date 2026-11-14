/**
 * The splits block (split-block.ts): the 1a vector read from the rows and
 * from the block a server would send gives the same figures, and the block
 * holds nothing of the other person.
 *
 * Setting: an ARS book valued at blue, Buenos Aires (UTC-3), the month starting
 * on the 5th, the clock 2026-11-14T15:00Z (budget month 202611). ARS per USD:
 * blue 1,500, official 1,000, dated 2026-10-01. Dining and a default envelope.
 *
 * The vector (all Dining, local days Nov 6 to 10):
 *   starting money 1,000,000.00, income 150,000.00, Dining assigned 300,000.00
 *   ARS 30,000.00                         30,000.00 as entered
 *   USD 10 booked at ARS 14,500.00        14,500.00 as booked
 *   USD 10 not booked                     10 x 1,500 = 15,000.00
 *   refund ARS 2,000.00                   -2,000.00
 *   USD 60 split, you paid, 30 / 30 with Bob: your 30 x 1,500 = 45,000.00
 *   Dining spent  = 30,000 + 14,500 + 15,000 - 2,000 + 45,000 = 102,500.00
 *   Dining left   = 300,000 - 102,500                         = 197,500.00
 *   Held for others (Bob's 30 USD front)                      =  45,000.00
 *   Money in                                                  = 150,000.00
 *   Not planned yet = 1,150,000 - 300,000 - 45,000            = 805,000.00
 *   Holds = 1,150,000 - 102,500 - 45,000                      = 1,002,500.00
 */
import { describe, expect, it } from "vitest";
import { dec } from "../precise-decimal";
import type {
	BookEnvelopeRow,
	BookRowCore,
	BookSource,
	CloseRowCore,
} from "./book-source";
import { budgetHoldsOf } from "./budget-holds";
import type { ExpenseRow } from "./entries";
import { createBudgetFigures } from "./figures";
import { loadBookFrom } from "./load-book";
import { monthViewFrom } from "./month-read";
import {
	type CheckpointSide,
	type SplitBlock,
	splitBlockOf,
	splitsFromBlock,
} from "./split-block";
import type { SplitPart } from "./split-events";
import type { MyShare, SplitInputs } from "./splits-input";
import type { MissingRate } from "./types";

const NOW = new Date("2026-11-14T15:00:00Z");
const NO_CHECKPOINT: CheckpointSide = {
	missingRates: [],
	approximate: [],
	own: new Set(),
};

const env = (id: string, name: string, order: number): BookEnvelopeRow => ({
	id,
	name,
	icon: null,
	color: null,
	kind: "MONTHLY",
	groupId: null,
	sortOrder: order,
	archivedAt: null,
	targetStartMonth: null,
	targetAmount: null,
	targetMode: "REFILL",
	targetCadence: "MONTH",
	targetMonthlyAmount: null,
	targetCurrency: null,
	targetDueDate: null,
	targetRepeat: null,
	targetTemplateId: null,
	targetLiabilityId: null,
	wealthDedicated: false,
	wealthAccountId: null,
	leftoverRule: "CARRY",
	leftoverSweepToId: null,
	categories: id === "dining" ? [{ categoryId: "cat-dining" }] : [],
});

const book: BookRowCore = {
	id: "book",
	createdById: "me",
	currency: "ARS",
	style: "SAVE_FIRST",
	fundingSource: "INCOME",
	pausedAt: null,
	weekStartDay: 1,
	timeZone: "America/Argentina/Buenos_Aires",
	startDate: new Date("2026-11-05T03:00:00Z"),
	startMonth: 202611,
	defaultEnvelopeId: "spending",
	startingBalanceExpenseId: "start",
	periods: [{ fromMonth: 202611, startDay: 5, rateType: "blue" }],
	groups: [],
	envelopes: [env("dining", "Dining", 0), env("spending", "Spending", 1)],
};

const row = (
	id: string,
	amount: string,
	at: string,
	o: Partial<ExpenseRow> = {},
): ExpenseRow => ({
	id,
	amount: dec(amount),
	currency: "ARS",
	amountInUSD: null,
	date: new Date(at),
	categoryId: "cat-dining",
	recurringTemplateId: null,
	direction: "OUT",
	entryKind: "STANDARD",
	homeCurrency: null,
	homeAmount: null,
	...o,
});

const usd = (id: string, at: string, o: Partial<ExpenseRow> = {}) =>
	row(id, "10", at, { currency: "USD", amountInUSD: dec("10"), ...o });

const OWN = {
	moneyIn: [
		row("start", "1000000", "2026-11-05T15:00:00Z", {
			direction: "IN",
			entryKind: "STARTING_BALANCE",
			categoryId: null,
		}),
		row("income", "150000", "2026-11-10T15:00:00Z", {
			direction: "IN",
			categoryId: null,
		}),
	],
	spending: [
		row("ars", "30000", "2026-11-06T15:00:00Z"),
		usd("usd-booked", "2026-11-07T15:00:00Z", {
			homeCurrency: "ARS",
			homeAmount: dec("14500"),
		}),
		usd("usd-unbooked", "2026-11-08T15:00:00Z"),
	],
	refunds: [row("refund", "2000", "2026-11-09T15:00:00Z", { direction: "IN" })],
	movements: [
		{
			month: 202611,
			fromEnvelopeId: null,
			toEnvelopeId: "dining",
			amount: "300000",
		},
	],
};

const SPLIT_TX = {
	id: "split",
	currency: "USD",
	date: new Date("2026-11-10T15:00:00Z"),
	exchangeRate: null,
	projectId: null,
	paidByType: "user" as const,
	paidById: "me",
};

const myShare: MyShare = {
	id: "my-part",
	participantType: "user",
	participantId: "me",
	shareAmount: dec("30"),
	verificationStatus: "ACCEPTED",
	categoryId: null,
	categorySource: null,
	transaction: {
		...SPLIT_TX,
		categoryId: "cat-dining",
		category: { userId: "me" },
	},
};

const bobsShare: SplitPart = {
	id: "bob-part",
	participantType: "shadow",
	participantId: "bob-shadow-id",
	shareAmount: dec("30"),
	verificationStatus: "ACCEPTED",
	transaction: SPLIT_TX,
};

function splitInputs(o: Partial<SplitInputs["rows"]> = {}): SplitInputs {
	return {
		userId: "me",
		rows: {
			routes: [],
			mine: [myShare],
			fronts: [bobsShare],
			settlements: [],
			categories: [{ id: "cat-dining" }],
			...o,
		},
		key: (ref) => `${ref.participantType}:${ref.participantId}`,
		rate: () => null,
	};
}

function source(
	splits: SplitInputs,
	extra: Partial<BookSource> = {},
): BookSource {
	return {
		book: async () => book,
		inputs: () => ({
			ownRows: async () => OWN,
			wealthRows: async () => [],
			rateRows: async () => [
				{ currency: "ARS", type: "blue", rate: "1500", date: "2026-10-01" },
				{ currency: "ARS", type: "official", rate: "1000", date: "2026-10-01" },
			],
		}),
		closes: async (): Promise<CloseRowCore[]> => [],
		dirtyMarks: async () => [],
		frozenValues: async () => new Map(),
		targetSources: async () => ({ templates: [], liabilities: [] }),
		dedicatedAccounts: async () => [],
		splits: async () => splits,
		hash: (text) => `h${text.length}`,
		...extra,
	};
}

/** The block a server would send for these rows. */
async function blockOf(
	splits: SplitInputs,
	checkpoint: CheckpointSide = NO_CHECKPOINT,
): Promise<SplitBlock> {
	const load = await loadBookFrom(source(splits), { now: NOW });
	if (!load) throw new Error("no book");
	return splitBlockOf(load.loaded.splits, load.loaded.shareSide, checkpoint);
}

/** A source that holds no split rows and answers with the block. */
function deviceSource(block: SplitBlock): BookSource {
	return source(splitInputs({ mine: [], fronts: [] }), {
		splits: async () => {
			throw new Error("a device has no split rows");
		},
		splitBlock: async () => block,
	});
}

async function figuresOf(src: BookSource) {
	const defs = createBudgetFigures<null>({
		month: async () => {
			const v = await monthViewFrom(
				{
					loadBook: async (ctx) =>
						(await loadBookFrom(src, ctx))?.loaded ?? null,
					groupBase: async () => null,
					startingBalanceEntry: async () => undefined,
				},
				NOW,
			);
			return v && !v.dto.incomplete ? v : null;
		},
		plan: async () => null,
		debt: async () => null,
	});
	const out: Record<string, unknown> = {};
	for (const id of [
		"envelope.spent",
		"envelope.left",
		"budget.heldForOthers",
		"budget.moneyIn",
		"budget.notPlannedYet",
		"budget.holds",
	])
		out[id] = await defs
			.find((d) => d.id === id)
			?.compute(null, { userId: "me", envelopeId: "dining" });
	return out;
}

const ars = (minor: number) => ({ minor, currency: "ARS" });

const VECTOR = {
	"envelope.spent": ars(10_250_000),
	"envelope.left": ars(19_750_000),
	"budget.heldForOthers": ars(4_500_000),
	"budget.moneyIn": ars(15_000_000),
	"budget.notPlannedYet": ars(80_500_000),
	"budget.holds": ars(100_250_000),
};

describe("the 1a vector", () => {
	it("reads as derived from the split rows", async () => {
		expect(await figuresOf(source(splitInputs()))).toEqual(VECTOR);
	});

	it("reads the same from the block, with no split rows", async () => {
		const block = await blockOf(splitInputs());
		expect(await figuresOf(deviceSource(block))).toEqual(VECTOR);
	});

	it("loads equal engine inputs and rates from the rows and from the block", async () => {
		const rows = await loadBookFrom(source(splitInputs()), { now: NOW });
		const block = await blockOf(splitInputs());
		const device = await loadBookFrom(deviceSource(block), { now: NOW });
		if (!rows || !device) throw new Error("no book");
		// Everything but the replay's effects, whose ids are opaque in the block.
		const { splits: deviceEffects, ...deviceInput } = device.loaded.input;
		const { splits: rowEffects, ...rowInput } = rows.loaded.input;
		expect(deviceInput).toEqual(rowInput);
		expect(deviceEffects).toEqual([
			{ ...rowEffects[0], eventId: "e1", counterparty: "p1" },
		]);
		expect(device.loaded.missingRates).toEqual(rows.loaded.missingRates);
		expect(device.loaded.approximate).toEqual(rows.loaded.approximate);
		expect(budgetHoldsOf(device.loaded.input)).toBe(
			budgetHoldsOf(rows.loaded.input),
		);
		// The own share entry is the 45,000.00 (4,500,000 minor) the block carries, valued.
		expect(block.shares).toEqual([
			{
				id: "my-part",
				month: 202611,
				date: "2026-11-10",
				minor: -4_500_000,
				source: "SHARE",
				categoryId: "cat-dining",
				envelopeId: null,
				pending: false,
			},
		]);
	});

	it("takes nothing of Bob into the block but opaque keys", async () => {
		const block = await blockOf(splitInputs());
		const text = JSON.stringify(block);
		for (const leaked of ["bob-part", "bob-shadow-id", "shadow:", "split"])
			expect(text).not.toContain(leaked);
		// Bob's front is the one event, his participation the first row key, he the first person.
		expect(block.events).toMatchObject([
			{ kind: "FRONT", id: "e1", counterparty: "p1", value: 4_500_000 },
		]);
		expect(block.balances).toMatchObject([
			{ counterparty: "p1", currency: "USD", native: 3000, basis: 4_500_000 },
		]);
	});
});

describe("splitsFromBlock", () => {
	it("keeps the replay and the lists the figures read, with no names", async () => {
		const block = await blockOf(
			splitInputs({
				routes: [
					{
						projectId: "trip",
						budgetRouting: "NOT_IN_BUDGET",
						budgetEnvelopeId: null,
						project: { name: "Secret trip" },
					},
				],
			}),
		);
		expect(JSON.stringify(block)).not.toContain("Secret trip");
		const splits = splitsFromBlock(block);
		expect(splits.replay.balances).toEqual(block.balances);
		expect(splits.events).toEqual(block.events);
		expect(splits.notInBudget).toEqual([{ projectId: "trip", name: "" }]);
		expect(splits.shares).toEqual([]);
	});
});

describe("rates the share side lacked", () => {
	// Your share of an XQZ split has no rate: it is left out of Dining, listed
	// with its currency, and the month reads incomplete (every figure null).
	const xqzShare: MyShare = {
		...myShare,
		id: "xqz-part",
		transaction: { ...myShare.transaction, id: "xqz-split", currency: "XQZ" },
	};
	const expected: MissingRate = {
		currency: "XQZ",
		rateType: null,
		date: "2026-11-10",
		rowId: "xqz-part",
	};

	it("lists the row from the rows and from the block alike", async () => {
		const inputs = splitInputs({ mine: [myShare, xqzShare] });
		const rows = await loadBookFrom(source(inputs), { now: NOW });
		const block = await blockOf(inputs);
		const device = await loadBookFrom(deviceSource(block), { now: NOW });
		expect(rows?.loaded.missingRates).toEqual([expected]);
		expect(device?.loaded.missingRates).toEqual([expected]);
		// Own ids pass through; nothing else was needed.
		expect(block.missingRates).toEqual([expected]);
		expect((await figuresOf(deviceSource(block)))["envelope.spent"]).toBeNull();
	});

	it("takes a rate missing behind the server's checkpoint and keeps its other ids opaque", async () => {
		const block = await blockOf(splitInputs(), {
			missingRates: [
				{
					currency: "ARS",
					rateType: "blue",
					date: "2026-10-20",
					rowId: "old-own-row",
				},
				{
					currency: "XQZ",
					rateType: null,
					date: "2026-10-21",
					rowId: "bobs-old-row",
				},
			],
			approximate: [{ rowId: "bobs-old-row", date: "2026-10-21" }],
			own: new Set(["old-own-row"]),
		});
		expect(block.checkpointMissingRates).toEqual([
			{
				currency: "ARS",
				rateType: "blue",
				date: "2026-10-20",
				rowId: "old-own-row",
			},
			{ currency: "XQZ", rateType: null, date: "2026-10-21", rowId: "e2" },
		]);
		// The same row is the same key wherever it appears.
		expect(block.checkpointApproximate).toEqual([
			{ rowId: "e2", date: "2026-10-21" },
		]);
		const device = await loadBookFrom(deviceSource(block), { now: NOW });
		expect(device?.loaded.missingRates.map((r) => r.currency).sort()).toEqual([
			"ARS",
			"XQZ",
		]);
		expect((await figuresOf(deviceSource(block)))["envelope.spent"]).toBeNull();
	});
});
