import { describe, expect, it } from "vitest";
import type { EnvelopeRowDto, GetMonthOutput } from "~/lib/schemas/envelope";
import {
	addDays,
	type BudgetFacts,
	budgetItems,
	type OwedPerson,
} from "./budget";

const ars = (minor: number) => ({ minor, currency: "ARS" });

function envelope(
	id: string,
	name: string,
	extra: Partial<EnvelopeRowDto> = {},
): EnvelopeRowDto {
	return {
		id,
		name,
		icon: null,
		color: null,
		kind: "MONTHLY",
		groupId: "g1",
		isDefault: false,
		sortOrder: 0,
		categoryIds: [],
		carryIn: ars(0),
		assigned: ars(0),
		activity: ars(0),
		spent: ars(0),
		spentBasis: 0,
		left: ars(0),
		pending: ars(0),
		status: "NO_TARGET",
		target: null,
		leftThisWeek: null,
		...extra,
	};
}

function bill(
	id: string,
	name: string,
	dueDate: string,
	need: number,
	paid = false,
) {
	return envelope(id, name, {
		kind: "BILL",
		status: "UNDERFUNDED",
		target: {
			kind: "BILL",
			mode: null,
			cadence: null,
			amount: ars(need),
			need: ars(need),
			dueDate,
			monthsLeft: 1,
			perMonth: ars(need),
			progress: null,
			projectedMonth: null,
			totalAtDue: null,
			paid,
			foreign: null,
			incomplete: false,
		},
	});
}

const zero = ars(0);

function month(o: {
	toAssign?: number;
	envelopes?: EnvelopeRowDto[];
	over?: { id: string; over: number }[];
	missing?: string[];
	unresolved?: number;
}): GetMonthOutput {
	const over = o.over ?? [];
	return {
		book: {
			id: "book1",
			style: "FLEX",
			fundingSource: "INCOME",
			currency: "ARS",
			startMonth: 202610,
			weekStartDay: 1,
			defaultEnvelopeId: "env-default",
			paused: false,
		},
		month: { key: 202610, from: "2026-10-01", to: "2026-10-31", state: "OPEN" },
		today: "2026-10-21",
		toAssign: {
			amount: ars(o.toAssign ?? 0),
			poolName: "NOT_PLANNED_YET",
			terms: {
				moneyIn: zero,
				assigned: zero,
				assignedAhead: zero,
				overspendTaken: zero,
				returned: zero,
				splitsNet: zero,
			},
		},
		groups: [
			{
				id: "g1",
				name: "Bills",
				role: "BILLS",
				sortOrder: 0,
				totals: {
					carryIn: zero,
					assigned: zero,
					activity: zero,
					spent: zero,
					left: zero,
					over: zero,
					need: zero,
					count: 0,
				},
				envelopes: o.envelopes ?? [],
			},
		],
		leftToSpend: {
			left: zero,
			perDay: zero,
			daysLeft: 11,
			carry: zero,
			assigned: zero,
			spent: zero,
			plannedTooMuch: zero,
			over: zero,
			billsHeld: zero,
			billsShort: zero,
			billsCount: 0,
			savings: zero,
			notPlanned: zero,
			fasterThanPlanned: false,
		},
		verdict: {
			style: "FLEX",
			month: 202610,
			lead: {
				kind: "LEFT_TO_SPEND",
				figureId: "budget.leftToSpend",
				amount: zero,
			},
			state: "ON_TRACK",
			perDay: zero,
			daysLeft: 11,
			over: ars(over.reduce((t, e) => t + e.over, 0)),
			overEnvelopes: over.map((e) => ({ id: e.id, over: ars(e.over) })),
			billsShort: zero,
			plannedTooMuch: zero,
			resetsOn: null,
			action: null,
			notice: null,
			poolName: "NOT_PLANNED_YET",
			limits: null,
			incomplete: (o.missing ?? []).length > 0,
		},
		owed: { held: zero, pending: zero, people: 0, aging: 0 },
		shares: { unresolved: o.unresolved ?? 0, pending: zero },
		incomplete: (o.missing ?? []).length > 0,
		approximate: false,
		missingRates: (o.missing ?? []).map((currency) => ({
			currency,
			rateType: "blue",
			date: "2026-10-20",
		})),
	};
}

const facts = (
	dto: GetMonthOutput,
	o: Partial<{
		paused: boolean;
		starting: boolean;
		moneyIn: BudgetFacts["moneyIn"];
		owed: BudgetFacts["owed"];
		balances: BudgetFacts["balances"];
	}> = {},
): BudgetFacts => ({
	dto,
	paused: o.paused ?? false,
	startingMoneyUnconfirmed: o.starting ?? false,
	moneyIn: o.moneyIn ?? [],
	owed: o.owed,
	balances: o.balances,
});

describe("budget Needs you items (SPEC §5.14)", () => {
	it("payday: ARS 850,000 not planned yet is one Give it a job item", () => {
		const [only, ...rest] = budgetItems(facts(month({ toAssign: 85_000_000 })));
		expect(rest).toEqual([]);
		expect(only).toMatchObject({
			id: "budget.giveJob",
			type: "budget.giveJob",
			group: "budget",
			entity: { kind: "book", id: "book1" },
			amount: ars(85_000_000),
			attention: false,
			actions: [
				{ entity: "budget", id: "usePlan" },
				{ entity: "budget", id: "assign" },
			],
		});
	});

	it("Give it a job names where the money came from, newest first, until it is covered (RC-2)", () => {
		// ARS 850,000 not planned: the salary (ARS 800,000, Oct 20) and ARS
		// 50,000 of the freelance job (ARS 120,000, Oct 12). Starting money
		// from Oct 1 is already planned, so it is not listed.
		const [only] = budgetItems(
			facts(month({ toAssign: 85_000_000 }), {
				moneyIn: [
					{
						id: "start",
						source: "STARTING_BALANCE",
						title: "Starting money",
						date: "2026-10-01",
						minor: 30_000_000,
					},
					{
						id: "salary",
						source: "INCOME",
						title: "Acme salary",
						date: "2026-10-20",
						minor: 80_000_000,
					},
					{
						id: "gig",
						source: "INCOME",
						title: "Freelance",
						date: "2026-10-12",
						minor: 12_000_000,
					},
				],
			}),
		);
		expect(only?.sources).toEqual([
			{
				entryId: "salary",
				kind: "INCOME",
				title: "Acme salary",
				date: "2026-10-20",
				amount: ars(80_000_000),
				part: ars(80_000_000),
			},
			{
				entryId: "gig",
				kind: "INCOME",
				title: "Freelance",
				date: "2026-10-12",
				amount: ars(12_000_000),
				part: ars(5_000_000),
			},
		]);
		expect(only).toMatchObject({ date: "2026-10-20", title: "Acme salary" });
	});

	it("more planned than there is: Take it back, the amount as a positive number", () => {
		expect(budgetItems(facts(month({ toAssign: -1_250_000 })))).toMatchObject([
			{ type: "budget.overAssigned", amount: ars(1_250_000) },
		]);
	});

	it("nothing to plan and nothing over: no items", () => {
		expect(budgetItems(facts(month({})))).toEqual([]);
	});

	it("two envelopes over: one item, amounts summed (12,000 + 3,500), no title", () => {
		const dto = month({
			envelopes: [envelope("e1", "Dining"), envelope("e2", "Taxi")],
			over: [
				{ id: "e1", over: 1_200_000 },
				{ id: "e2", over: 350_000 },
			],
		});
		expect(budgetItems(facts(dto))).toMatchObject([
			{
				type: "budget.overspent",
				entity: { kind: "envelope", id: "e1" },
				entityIds: ["e1", "e2"],
				amount: ars(1_550_000),
				count: 2,
				title: null,
				attention: true,
			},
		]);
	});

	it("one envelope over: its name is the title", () => {
		const dto = month({
			envelopes: [envelope("e1", "Dining")],
			over: [{ id: "e1", over: 500 }],
		});
		expect(budgetItems(facts(dto))[0]).toMatchObject({
			title: "Dining",
			count: 1,
		});
	});

	it("bills: due within 7 days and short; paid, later or fully funded bills stay out", () => {
		const dto = month({
			envelopes: [
				bill("rent", "Rent", "2026-10-28", 40_000_000),
				bill("net", "Internet", "2026-10-24", 4_150_000),
				bill("gym", "Gym", "2026-10-29", 1_000_000),
				bill("paid", "Phone", "2026-10-22", 900_000, true),
				bill("funded", "Water", "2026-10-23", 0),
			],
		});
		// Oct 21 + 7 = Oct 28: Rent and Internet; Gym (29th) waits.
		expect(budgetItems(facts(dto))).toMatchObject([
			{
				type: "budget.billDue",
				entity: { kind: "envelope", id: "net" },
				entityIds: ["net", "rent"],
				amount: ars(44_150_000),
				date: "2026-10-24",
				count: 2,
				attention: false,
			},
		]);
	});

	it("a bill past its due day and still short needs attention", () => {
		const dto = month({ envelopes: [bill("rent", "Rent", "2026-10-20", 100)] });
		expect(budgetItems(facts(dto))[0]).toMatchObject({
			title: "Rent",
			date: "2026-10-20",
			attention: true,
		});
	});

	it("a missing rate names the currencies and hides every amount item (R14)", () => {
		const dto = month({
			toAssign: 100,
			missing: ["BRL", "USD", "BRL"],
			over: [{ id: "e1", over: 5 }],
		});
		expect(budgetItems(facts(dto))).toMatchObject([
			{ type: "budget.missingRate", currencies: ["BRL", "USD"], amount: null },
		]);
	});

	it("starting money not confirmed asks once, even with a missing rate", () => {
		const types = budgetItems(
			facts(month({ missing: ["BRL"] }), { starting: true }),
		).map((i) => i.type);
		expect(types).toEqual(["budget.missingRate", "budget.startingMoney"]);
	});

	it("Just track (paused): no budget items at all", () => {
		expect(
			budgetItems(
				facts(month({ toAssign: 100 }), { paused: true, starting: true }),
			),
		).toEqual([]);
	});

	it("Limits: To assign is hidden, so no pool and no starting money item", () => {
		const dto = month({ toAssign: -62_000 });
		const limits = {
			...dto,
			book: { ...dto.book, fundingSource: "TARGETS" as const },
		};
		expect(budgetItems(facts(limits, { starting: true }))).toEqual([]);
	});

	it("two summaries waiting: one item with both months, dated by the newest", () => {
		const items = budgetItems({
			...facts(month({})),
			closes: {
				waiting: [
					{ month: 202609, from: "2026-09-01" },
					{ month: 202610, from: "2026-10-01" },
				],
				changed: null,
			},
		});
		expect(items).toMatchObject([
			{
				type: "budget.monthSummary",
				entityIds: ["202609", "202610"],
				count: 2,
				date: "2026-10-01",
				amount: null,
			},
		]);
	});

	it("a change after the window: one item on the envelope that moved most (Restaurants +12,000)", () => {
		const dto = month({ envelopes: [envelope("rest", "Restaurants")] });
		const items = budgetItems({
			...facts(dto),
			closes: {
				waiting: [],
				changed: {
					earliestMonth: 202503,
					earliestFrom: "2025-03-01",
					toAssign: 0,
					envelopes: [{ id: "rest", delta: 12_000 }],
				},
			},
		});
		expect(items).toMatchObject([
			{
				type: "budget.monthChanged",
				entity: { kind: "envelope", id: "rest" },
				amount: ars(12_000),
				date: "2025-03-01",
				title: "Restaurants",
				count: 1,
			},
		]);
	});

	it("reconciled before and not this month: the monthly check", () => {
		expect(
			budgetItems({ ...facts(month({})), reconcileDue: true }).map(
				(i) => i.type,
			),
		).toEqual(["budget.reconcile"]);
	});

	it("hidden expenses waiting after a move from the old budget: one item with the count, none at zero", () => {
		const items = budgetItems({ ...facts(month({})), hiddenRows: 3 });
		expect(items.map((i) => [i.type, i.count, i.group])).toEqual([
			["budget.hiddenReview", 3, "budget"],
		]);
		expect(budgetItems({ ...facts(month({})), hiddenRows: 0 })).toEqual([]);
	});

	it("addDays crosses months and years", () => {
		expect(addDays("2026-10-28", 7)).toBe("2026-11-04");
		expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
	});
});

const person = (
	type: "user" | "shadow",
	id: string,
	o: {
		aging: boolean;
		lines?: { amount: number; currency: string; oldestOpen: string | null }[];
		held?: number;
	},
): OwedPerson => ({
	participant: { type, id },
	name: null,
	lines: (o.lines ?? []).map((l) => ({
		amount: { minor: l.amount, currency: l.currency },
		held: ars(0),
		oldestOpen: l.oldestOpen,
		ageDays: null,
	})),
	held: ars(o.held ?? 0),
	pending: ars(0),
	lastPaidOn: null,
	ageDays: null,
	aging: o.aging,
});

describe("shares that need an envelope (D19)", () => {
	it("three shares with no category are one item with the count", () => {
		const [only, ...rest] = budgetItems(facts(month({ unresolved: 3 })));
		expect(rest).toEqual([]);
		expect(only).toMatchObject({
			id: "budget.sharesNeedEnvelope",
			group: "budget",
			entity: { kind: "book", id: "book1" },
			count: 3,
			amount: null,
			actions: [{ entity: "budget", id: "pickEnvelope" }],
		});
	});

	it("none unresolved, no item; a missing rate leaves it out with the other amounts", () => {
		expect(budgetItems(facts(month({})))).toEqual([]);
		const types = budgetItems(
			facts(month({ unresolved: 2, missing: ["BRL"] })),
		).map((i) => i.type);
		expect(types).toEqual(["budget.missingRate"]);
	});
});

describe("owed for 60 days (SPEC 5.8, C15)", () => {
	// The replay says who is aging; People's ledger says how much they owe.
	const aging = [
		person("shadow", "paz", {
			aging: true,
			lines: [{ amount: 200_000, currency: "ARS", oldestOpen: "2026-07-15" }],
		}),
		person("user", "lu", {
			aging: true,
			lines: [
				{ amount: 5_000, currency: "USD", oldestOpen: "2026-08-01" },
				{ amount: 60_000, currency: "ARS", oldestOpen: "2026-07-01" },
			],
		}),
		person("user", "ana", {
			aging: true,
			lines: [{ amount: 1_000, currency: "USD", oldestOpen: null }],
		}),
		person("user", "recent", {
			aging: false,
			lines: [{ amount: 100, currency: "ARS", oldestOpen: "2026-10-01" }],
		}),
	];
	const balances = new Map<string, Record<string, number>>([
		// People's ledger: Paz owes ARS 2,100.00, not the replay's 2,000.00.
		["shadow:paz", { ARS: 210_000 }],
		["user:lu", { USD: 5_000, ARS: 60_000 }],
		// People shows Ana as even: no item.
		["user:ana", {}],
		["user:recent", { ARS: 100 }],
	]);

	it("one item per aging person, with People's amount, none for the rest", () => {
		const items = budgetItems(facts(month({}), { owed: aging, balances }));
		expect(items.map((i) => i.id)).toEqual([
			"people.owedAging:shadow:paz",
			"people.owedAging:user:lu",
		]);
		expect(items[0]).toMatchObject({
			type: "people.owedAging",
			group: "people",
			entity: { kind: "person", id: "shadow:paz" },
			people: ["shadow:paz"],
			amount: { minor: 210_000, currency: "ARS" },
			date: "2026-07-15",
			attention: true,
			actions: [{ entity: "person", id: "remind" }],
		});
	});

	it("several currencies show no single amount; the date is the oldest open part", () => {
		const [, lu] = budgetItems(facts(month({}), { owed: aging, balances }));
		expect(lu).toMatchObject({ amount: null, date: "2026-07-01" });
	});

	it("without People's balances nothing is guessed", () => {
		expect(budgetItems(facts(month({}), { owed: aging }))).toEqual([]);
	});

	it("People items stay when a missing rate blanks the budget amounts", () => {
		const types = budgetItems(
			facts(month({ missing: ["BRL"] }), { owed: aging, balances }),
		).map((i) => i.type);
		expect(types).toEqual([
			"budget.missingRate",
			"people.owedAging",
			"people.owedAging",
		]);
	});

	it("a paused book (Just track) asks nothing", () => {
		expect(
			budgetItems(facts(month({}), { paused: true, owed: aging, balances })),
		).toEqual([]);
	});
});
