/**
 * The pure loader over a hand-made source: what it values, what it hands back
 * to be stored (first values, the stale mark) and what it writes (nothing: a
 * source has no write). Book in ARS, Dining and Spending envelopes, UTC, the
 * clock 2026-11-14T15:00Z (budget month 202611, the 1st).
 */
import { describe, expect, it } from "vitest";
import { dec } from "../precise-decimal";
import type {
	BookEnvelopeRow,
	BookRowCore,
	BookSource,
	CloseRowCore,
} from "./book-source";
import type { StoredCheckpoint } from "./checkpoint";
import type { ExpenseRow } from "./entries";
import { loadBookFrom } from "./load-book";
import { frozenKey } from "./valuer";

const NOW = new Date("2026-11-14T15:00:00Z");

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

const book = (o: Partial<BookRowCore> = {}): BookRowCore => ({
	id: "book",
	createdById: "me",
	currency: "ARS",
	style: "FLEX",
	fundingSource: "INCOME",
	pausedAt: null,
	weekStartDay: 1,
	timeZone: "UTC",
	startDate: new Date("2026-11-01T00:00:00Z"),
	startMonth: 202611,
	defaultEnvelopeId: "spending",
	startingBalanceExpenseId: null,
	periods: [{ fromMonth: 202611, startDay: 1, rateType: "blue" }],
	groups: [],
	envelopes: [env("dining", "Dining", 0), env("spending", "Spending", 1)],
	...o,
});

/** A USD 10 row with no booked value, dated Nov 6: valued at blue 1,500 = ARS 15,000.00. */
const usdRow: ExpenseRow = {
	id: "usd-row",
	amount: dec("10"),
	currency: "USD",
	amountInUSD: dec("10"),
	date: new Date("2026-11-06T15:00:00Z"),
	categoryId: "cat-dining",
	recurringTemplateId: null,
	direction: "OUT",
	entryKind: "STANDARD",
	homeCurrency: null,
	homeAmount: null,
};

function source(o: {
	row?: BookRowCore | null;
	closes?: CloseRowCore[];
	dirty?: Array<{ id: bigint; fromMonth: number; createdAt: Date }>;
	frozen?: Map<string, { minor: number; approximate: boolean }>;
	rows?: ExpenseRow[];
}): BookSource {
	const row = o.row === undefined ? book() : o.row;
	return {
		book: async () => row,
		inputs: () => ({
			ownRows: async () => ({
				moneyIn: [],
				spending: o.rows ?? [],
				refunds: [],
				movements: [],
			}),
			wealthRows: async () => [],
			rateRows: async () => [
				{
					currency: "ARS",
					type: "blue",
					rate: "1500",
					date: "2026-10-01",
				},
			],
		}),
		closes: async () => o.closes ?? [],
		dirtyMarks: async () => o.dirty ?? [],
		frozenValues: async () => o.frozen ?? new Map(),
		targetSources: async () => ({ templates: [], liabilities: [] }),
		dedicatedAccounts: async () => [],
		splits: async () => ({
			userId: "me",
			rows: {
				routes: [],
				mine: [],
				fronts: [],
				settlements: [],
				categories: [],
			},
			key: (ref) => `${ref.participantType}:${ref.participantId}`,
			rate: () => null,
		}),
		hash: (text) => `h${text.length}`,
	};
}

describe("loadBookFrom", () => {
	it("is null without a book and without a default envelope", async () => {
		expect(await loadBookFrom(source({ row: null }), { now: NOW })).toBeNull();
		expect(
			await loadBookFrom(source({ row: book({ defaultEnvelopeId: null }) }), {
				now: NOW,
			}),
		).toBeNull();
	});

	it("values a foreign row once at blue and hands the first value back to be frozen", async () => {
		const load = await loadBookFrom(source({ rows: [usdRow] }), { now: NOW });
		if (!load) throw new Error("no book");
		// 10 USD x 1,500 = ARS 15,000.00 = 1,500,000 minor, spent (negative), in Nov.
		expect(load.loaded.input.activity).toEqual([
			{
				id: "usd-row",
				month: 202611,
				date: "2026-11-06",
				minor: -1_500_000,
				source: "SPENT",
				categoryId: "cat-dining",
				envelopeId: null,
				recurring: false,
			},
		]);
		expect(load.fresh).toEqual([
			{
				key: frozenKey(usdRow, "2026-11-06", "blue"),
				minor: 1_500_000,
				approximate: false,
				rateDate: "2026-10-01",
			},
		]);
		expect(load.staleFrom).toBeNull();
		expect(load.loaded.today).toBe("2026-11-14");
		expect(load.loaded.input.currentMonth).toBe(202611);
	});

	it("reads a frozen value instead of the rate and has nothing new to freeze", async () => {
		const frozen = new Map([
			[
				frozenKey(usdRow, "2026-11-06", "blue"),
				{ minor: 1_400_000, approximate: false },
			],
		]);
		const load = await loadBookFrom(source({ rows: [usdRow], frozen }), {
			now: NOW,
		});
		expect(load?.loaded.input.activity[0]?.minor).toBe(-1_400_000);
		expect(load?.fresh).toEqual([]);
	});

	describe("a closed month whose checkpoint no longer matches the loaded rows", () => {
		// October is closed; its print is not what the fully loaded rows hash to.
		const stale: StoredCheckpoint = {
			v: 1,
			month: 202610,
			carry: {},
			totals: {
				moneyIn: 0,
				assigned: 0,
				overspent: 0,
				returned: 0,
				fronted: 0,
				returnedByPeople: 0,
				forgiven: 0,
				oldDebtsPaid: 0,
			},
			missingRates: [],
			approximate: [],
			print: "old",
		};
		const closes: CloseRowCore[] = [
			{
				month: 202610,
				summary: { envelopes: [] },
				checkpoint: stale,
			},
		];
		const octoberBook = book({
			startMonth: 202610,
			startDate: new Date("2026-10-01T00:00:00Z"),
			periods: [{ fromMonth: 202610, startDay: 1, rateType: "blue" }],
		});

		it("asks for one mark from that month and starts the pass from the book's start", async () => {
			const load = await loadBookFrom(source({ row: octoberBook, closes }), {
				now: NOW,
			});
			expect(load?.staleFrom).toBe(202610);
			expect(load?.loaded.checkpoint).toBeNull();
		});

		it("asks for none when a mark already covers the month", async () => {
			const load = await loadBookFrom(
				source({
					row: octoberBook,
					closes,
					dirty: [{ id: 1n, fromMonth: 202610, createdAt: NOW }],
				}),
				{ now: NOW },
			);
			expect(load?.staleFrom).toBeNull();
		});
	});
});
