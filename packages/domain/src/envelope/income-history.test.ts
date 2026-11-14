/**
 * Typical income's closed months over a reader of income rows: which rows it
 * asks for, what it makes of them, and that a book in its first month reads
 * nothing. ARS book, UTC, month on the 1st, the clock 2026-11-14T15:00Z.
 */
import { describe, expect, it } from "vitest";
import { dec } from "../precise-decimal";
import type { BookEnvelopeRow, BookRowCore, BookSource } from "./book-source";
import type { ExpenseRow } from "./entries";
import { closedIncomesFrom, groupBaseFrom } from "./income-history";
import { loadBookFrom } from "./load-book";

const NOW = new Date("2026-11-14T15:00:00Z");

const spending: BookEnvelopeRow = {
	id: "spending",
	name: "Spending",
	icon: null,
	color: null,
	kind: "MONTHLY",
	groupId: null,
	sortOrder: 0,
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
	categories: [],
};

const book = (startMonth: number, startDate: string): BookRowCore => ({
	id: "book",
	createdById: "me",
	currency: "ARS",
	style: "FLEX",
	fundingSource: "INCOME",
	pausedAt: null,
	weekStartDay: 1,
	timeZone: "UTC",
	startDate: new Date(`${startDate}T00:00:00Z`),
	startMonth,
	defaultEnvelopeId: "spending",
	startingBalanceExpenseId: null,
	periods: [{ fromMonth: startMonth, startDay: 1, rateType: "blue" }],
	groups: [],
	envelopes: [spending],
});

const source = (row: BookRowCore): BookSource => ({
	book: async () => row,
	inputs: () => ({
		ownRows: async () => ({
			moneyIn: [],
			spending: [],
			refunds: [],
			movements: [],
		}),
		wealthRows: async () => [],
		rateRows: async () => [],
	}),
	closes: async () => [],
	dirtyMarks: async () => [],
	frozenValues: async () => new Map(),
	targetSources: async () => ({ templates: [], liabilities: [] }),
	dedicatedAccounts: async () => [],
	splits: async () => ({
		userId: "me",
		rows: { routes: [], mine: [], fronts: [], settlements: [], categories: [] },
		key: (ref) => `${ref.participantType}:${ref.participantId}`,
		rate: () => null,
	}),
	hash: (text) => `h${text.length}`,
});

const income = (id: string, amount: string, at: string): ExpenseRow => ({
	id,
	amount: dec(amount),
	currency: "ARS",
	amountInUSD: null,
	date: new Date(at),
	categoryId: null,
	recurringTemplateId: null,
	direction: "IN",
	entryKind: "STANDARD",
	homeCurrency: null,
	homeAmount: null,
});

async function loaded(row: BookRowCore) {
	const load = await loadBookFrom(source(row), { now: NOW });
	if (!load) throw new Error("no book");
	return load.loaded;
}

describe("closedIncomesFrom", () => {
	it("reads nothing in the book's first month", async () => {
		let reads = 0;
		const closed = await closedIncomesFrom(
			async () => {
				reads++;
				return [];
			},
			await loaded(book(202611, "2026-11-01")),
		);
		expect(closed).toEqual({ months: [], incomplete: false });
		expect(reads).toBe(0);
	});

	it("asks for the three months before this one, with two days of slack, and sums each", async () => {
		const asked: Array<{ from: string; to: string }> = [];
		const rows = [
			income("aug", "100000", "2026-08-10T15:00:00Z"),
			income("sep-a", "100000", "2026-09-10T15:00:00Z"),
			income("sep-b", "50000", "2026-09-20T15:00:00Z"),
			// No income in October: the month still counts, as 0.
		];
		const closed = await closedIncomesFrom(
			async (w) => {
				asked.push({ from: w.from.toISOString(), to: w.to.toISOString() });
				return rows;
			},
			await loaded(book(202608, "2026-08-01")),
		);
		// From Aug 1 (the book's start, later than Jul 30), up to Nov 3.
		expect(asked).toEqual([
			{ from: "2026-08-01T00:00:00.000Z", to: "2026-11-03T00:00:00.000Z" },
		]);
		// ARS 100,000.00; 150,000.00; 0.00 in minor units, oldest first.
		expect(closed).toEqual({
			months: [10_000_000, 15_000_000, 0],
			incomplete: false,
		});
	});
});

describe("groupBaseFrom", () => {
	it("uses this month's income when there is some, without reading the closed months", async () => {
		const l = await loaded(book(202611, "2026-11-01"));
		const withIncome = {
			...l,
			input: {
				...l.input,
				moneyIn: [
					{
						id: "i",
						month: 202611,
						minor: 12_000_000,
						source: "INCOME" as const,
					},
				],
			},
		};
		let reads = 0;
		const base = await groupBaseFrom(
			async () => {
				reads++;
				return { months: [], incomplete: false };
			},
			withIncome,
			202611,
		);
		expect(base).toEqual({
			base: 12_000_000,
			source: "THIS_MONTH",
			incomplete: false,
		});
		expect(reads).toBe(0);
	});

	it("falls back to the typical income of the closed months", async () => {
		const l = await loaded(book(202611, "2026-11-01"));
		const base = await groupBaseFrom(
			async () => ({
				months: [10_000_000, 15_000_000, 12_000_000],
				incomplete: false,
			}),
			l,
			202611,
		);
		expect(base).toEqual({
			base: 12_000_000,
			source: "TYPICAL",
			incomplete: false,
		});
	});
});
