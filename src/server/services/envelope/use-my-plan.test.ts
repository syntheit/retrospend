/**
 * Use my plan's rest (D-owner-2026-10-22e): Leave it (default), Save it,
 * Next month. Values by hand.
 */
import { describe, expect, it } from "vitest";
import { computeBook, type EngineInput } from "./engine";
import type { LoadedBook } from "./inputs";
import type { MonthRead } from "./month-read";
import { buildMonthView, type ViewBook } from "./month-view";
import { proposePlan } from "./use-my-plan";

const usd = (minor: number) => ({ minor, currency: "USD" });

/** USD Flex book in October: Rent (set aside 500), Groceries (refill 300), Vacation (savings). */
function readFor(
	money: number,
	opts: { month?: number; savings?: boolean } = {},
): MonthRead {
	const savings = opts.savings ?? true;
	const envelopes = [
		{
			id: "rent",
			groupId: "bills",
			target: {
				kind: "MONTHLY" as const,
				amount: 50_000,
				mode: "SET_ASIDE" as const,
				cadence: "MONTH" as const,
			},
		},
		{
			id: "groceries",
			groupId: "spending",
			target: {
				kind: "MONTHLY" as const,
				amount: 30_000,
				mode: "REFILL" as const,
				cadence: "MONTH" as const,
			},
		},
		...(savings
			? [
					{
						id: "vacation",
						groupId: "savings",
						target: null,
						kind: "SAVINGS" as const,
					},
				]
			: []),
		{ id: "everything", groupId: "spending", target: null },
	];
	const input: EngineInput = {
		startMonth: 202610,
		currentMonth: 202610,
		defaultEnvelopeId: "everything",
		envelopes: envelopes.map((e) => ({
			id: e.id,
			kind: "kind" in e && e.kind ? e.kind : "MONTHLY",
			leftoverRule: "CARRY",
			sweepToId: null,
			categoryIds: [],
		})),
		moneyIn: [{ id: "salary", month: 202610, minor: money, source: "INCOME" }],
		activity: [],
		movements: [],
		splits: [],
	};
	const book: ViewBook = {
		id: "book",
		style: "FLEX",
		fundingSource: "INCOME",
		currency: "USD",
		startMonth: 202610,
		weekStartDay: 1,
		periods: [{ fromMonth: 202610, startDay: 1 }],
		defaultEnvelopeId: "everything",
		groups: [
			{ id: "bills", name: "Bills", role: "BILLS", order: 0 },
			{ id: "spending", name: "Spending", role: "SPENDING", order: 1 },
			...(savings
				? [
						{
							id: "savings",
							name: "Savings",
							role: "SAVINGS" as const,
							order: 2,
						},
					]
				: []),
		],
		envelopes: envelopes.map((e, order) => ({
			id: e.id,
			name: e.id,
			icon: null,
			color: null,
			kind: "kind" in e && e.kind ? e.kind : "MONTHLY",
			groupId: e.groupId,
			order,
			categoryIds: [],
			archived: false,
			target: e.target,
			targetStartMonth: null,
			foreign: null,
			targetIncomplete: false,
		})),
	};
	const month = opts.month ?? 202610;
	const view = buildMonthView({
		book,
		input,
		state: computeBook(input, month),
		month,
		today: "2026-10-05",
		missingRates: [],
	});
	const loaded = {
		book,
		input,
		today: "2026-10-05",
		missingRates: [],
	} as unknown as LoadedBook;
	return { ...view, loaded };
}

const lines = (p: ReturnType<typeof proposePlan>) =>
	p.lines.map((l) => [l.envelopeId, l.month, l.amount.minor, l.step]);

describe("Use my plan with a rest choice", () => {
	it("offers Save it (Vacation), Next month (November) and Leave it", () => {
		expect(proposePlan(readFor(150_000), 150_000).restOptions).toEqual([
			{ choice: "SAVE", envelopeId: "vacation", month: null },
			{ choice: "NEXT_MONTH", envelopeId: null, month: 202611 },
			{ choice: "LEAVE", envelopeId: null, month: null },
		]);
	});

	it("Leave it (default): rent 500 and groceries 300; 700 stays Not planned yet", () => {
		const p = proposePlan(readFor(150_000), 150_000);
		expect(lines(p)).toEqual([
			["rent", 202610, 50_000, "MONTHLY"],
			["groceries", 202610, 30_000, "MONTHLY"],
		]);
		expect(p.rest).toEqual(usd(70_000));
		expect(p.restChoice).toBe("LEAVE");
	});

	it("Save it: the 700 goes to Vacation this month; nothing stays", () => {
		const p = proposePlan(readFor(150_000), 150_000, "SAVE");
		expect(lines(p).at(-1)).toEqual(["vacation", 202610, 70_000, "REST"]);
		expect(p.rest).toEqual(usd(0));
	});

	it("Next month: November's rent takes 500 (set aside), groceries need 0 (October's 300 carries), 200 to Vacation", () => {
		const p = proposePlan(readFor(150_000), 150_000, "NEXT_MONTH");
		expect(lines(p)).toEqual([
			["rent", 202610, 50_000, "MONTHLY"],
			["groceries", 202610, 30_000, "MONTHLY"],
			["rent", 202611, 50_000, "MONTHLY"],
			["vacation", 202611, 20_000, "REST"],
		]);
		expect(p.rest).toEqual(usd(0));
	});

	it("without a Savings group there is no Save it, and Next month's extra stays Not planned yet", () => {
		const read = readFor(150_000, { savings: false });
		expect(proposePlan(read, 150_000).restOptions.map((o) => o.choice)).toEqual(
			["NEXT_MONTH", "LEAVE"],
		);
		const p = proposePlan(read, 150_000, "NEXT_MONTH");
		expect(p.rest).toEqual(usd(20_000));
		const saved = proposePlan(read, 150_000, "SAVE");
		expect(saved.restChoice).toBe("LEAVE");
		expect(saved.rest).toEqual(usd(70_000));
	});

	it("viewing next month, Next month is not offered (money moves this month and next only, D22)", () => {
		const read = readFor(150_000, { month: 202611 });
		expect(proposePlan(read, 10_000).restOptions.map((o) => o.choice)).toEqual([
			"SAVE",
			"LEAVE",
		]);
	});
});
