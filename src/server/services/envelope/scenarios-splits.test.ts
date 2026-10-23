/**
 * P3 scenario rows (wargame 01 §2, build plan 02 §7): splits through the
 * same pure path getMonth runs (routing, share categories, replay events,
 * replay, engine, month view), on hand-made rows. Expected values are
 * worked out by hand in the comments, never read back from the engine.
 * Every row also checks the SPEC §5.3 invariant:
 *   ToAssign(c) + Σ Left(e, c) + Assigned(c+1) = MoneyIn - Σ outflows - SplitsNet
 *
 * Rates (fixtures): ARS blue 1,465 from 2026-10-01 and 1,530 from
 * 2027-01-01; BRL 5.40 and CLP 960 per USD. Amounts are minor units.
 */
import { describe, expect, it } from "vitest";
import {
	front,
	income,
	mine,
	runSplits,
	type SplitScenario,
	settlement,
	type TxSpec,
} from "./__tests__/split-rows";

function expectInvariant(r: ReturnType<typeof runSplits>) {
	expect(r.sides.budget).toBe(r.sides.ledger);
}

// ── S4 and S25: Alex and Sam, Austin (USD) ─────────────────────────────────

describe("S4 a split someone else made hits your envelope (Alex, USD)", () => {
	const groceries: TxSpec = {
		id: "t-groc",
		currency: "USD",
		date: "2026-10-10",
		paidBy: "user:sam",
		category: { id: "sam-food", name: "Food", owner: "sam" },
	};
	const base = (share = mine("s-groc", groceries, "70")): SplitScenario => ({
		currency: "USD",
		start: 202610,
		current: 202610,
		today: "2026-10-20",
		envelopes: [{ id: "groceries", cats: ["c-groc"] }, { id: "everything" }],
		defaultEnvelope: "everything",
		moneyIn: [income(202610, 100_000)],
		mine: [share],
		categories: [{ id: "c-groc", name: "Groceries" }],
	});

	it("unresolved: the USD 70 lands in Everything else, one share to place, you owe Sam USD 70", () => {
		const r = runSplits(base());
		expect(r.left("everything")).toBe(-7_000);
		expect(r.left("groceries")).toBe(0);
		expect(r.view.shares.unresolved).toBe(1);
		expect(r.balance("user:sam", "USD")).toBe(-7_000);
		// You owe Sam: nothing is held for it, To assign keeps the 1,000.
		expect(r.view.toAssign.amount.minor).toBe(100_000);
		expect(r.view.owed.held.minor).toBe(0);
		expectInvariant(r);
	});

	it("you pick Groceries: Groceries Activity -70, nothing left to place", () => {
		const r = runSplits(
			base(mine("s-groc", groceries, "70", { categoryId: "c-groc" })),
		);
		expect(r.left("groceries")).toBe(-7_000);
		expect(r.left("everything")).toBe(0);
		expect(r.view.shares.unresolved).toBe(0);
		expectInvariant(r);
	});

	it("Sam's category has your category's name: the smart default places it and asks to store it", () => {
		const r = runSplits(
			base(
				mine(
					"s-groc",
					{
						...groceries,
						category: { id: "sam-g", name: "groceries", owner: "sam" },
					},
					"70",
				),
			),
		);
		expect(r.left("groceries")).toBe(-7_000);
		expect(r.splits.unsaved).toEqual([
			{ shareId: "s-groc", categoryId: "c-groc", source: "NAME_MATCH" },
		]);
		expectInvariant(r);
	});
});

describe("S25 a pending, then rejected split (Alex, USD)", () => {
	const tv: TxSpec = {
		id: "t-tv",
		currency: "USD",
		date: "2026-10-12",
		paidBy: "user:sam",
		category: { id: "sam-el", name: "Electronics", owner: "sam" },
	};
	const scenario = (shares: SplitScenario["mine"]): SplitScenario => ({
		currency: "USD",
		start: 202610,
		current: 202610,
		today: "2026-10-14",
		envelopes: [{ id: "home", cats: ["c-home"] }, { id: "everything" }],
		defaultEnvelope: "everything",
		moneyIn: [income(202610, 100_000)],
		mine: shares,
		categories: [{ id: "c-home", name: "Home" }],
	});

	it("pending: USD 150 counts in Home, flagged pending your OK, and you owe Sam 150", () => {
		const r = runSplits(
			scenario([
				mine("s-tv", tv, "150", { status: "PENDING", categoryId: "c-home" }),
			]),
		);
		expect(r.left("home")).toBe(-15_000);
		expect(r.view.shares.pending.minor).toBe(-15_000);
		expect(r.balance("user:sam", "USD")).toBe(-15_000);
		expectInvariant(r);
	});

	it("rejected: the share definition drops it, so envelope and owed clear together", () => {
		const r = runSplits(scenario([]));
		expect(r.left("home")).toBe(0);
		expect(r.view.shares.pending.minor).toBe(0);
		expect(r.balance("user:sam", "USD")).toBe(0);
		expectInvariant(r);
	});

	it("Sam's side: Alex rejected, but Sam's cash left, so USD 150 stays fronted", () => {
		const paid = { ...tv, paidBy: "user:me" };
		const r = runSplits({
			...scenario([mine("s-mine", paid, "150", { categoryId: "c-home" })]),
			fronts: [front("f-alex", "user:alex", paid, "150", "REJECTED")],
		});
		// 1,000 in, 150 out with Alex: To assign 850; Home -150.
		expect(r.view.toAssign.terms.splitsNet.minor).toBe(15_000);
		expect(r.view.toAssign.amount.minor).toBe(85_000);
		expect(r.left("home")).toBe(-15_000);
		expectInvariant(r);
	});
});

// ── S5 and C14: Lucía, Buenos Aires (ARS) ──────────────────────────────────

describe("S5 a friend pays you back, and C14 a forgiven balance (Lucía, ARS)", () => {
	// Asado ARS 90,000 for three, paid by Lucía in her Dining; 30,000 each.
	const asado: TxSpec = {
		id: "t-asado",
		currency: "ARS",
		date: "2026-10-04",
		paidBy: "user:me",
		category: { id: "c-din", name: "Dining", owner: "me" },
	};
	const scenario = (
		settlements: SplitScenario["settlements"],
	): SplitScenario => ({
		currency: "ARS",
		rateType: "blue",
		start: 202610,
		current: 202610,
		today: "2026-10-21",
		envelopes: [{ id: "dining", cats: ["c-din"] }, { id: "everything" }],
		defaultEnvelope: "everything",
		moneyIn: [income(202610, 10_000_000)],
		mine: [mine("s-asado", asado, "30000")],
		fronts: [
			front("f-juan", "user:juan", asado, "30000"),
			front("f-paz", "user:paz", asado, "30000"),
		],
		settlements,
	});
	const juanPays = settlement(
		"p-juan",
		"user:juan",
		"user:me",
		"30000",
		"ARS",
		"2026-10-11",
	);

	it("S5 Dining -30,000 only; 60,000 fronted, Juan's 30,000 back: To assign 70,000, 30,000 held for Paz", () => {
		const r = runSplits(scenario([juanPays]));
		expect(r.left("dining")).toBe(-3_000_000);
		expect(r.view.toAssign.terms.splitsNet.minor).toBe(3_000_000);
		expect(r.view.toAssign.amount.minor).toBe(7_000_000);
		expect(r.view.owed).toEqual({
			held: { minor: 3_000_000, currency: "ARS" },
			pending: { minor: 0, currency: "ARS" },
			people: 1,
			aging: 0,
		});
		expect(r.balance("user:juan", "ARS")).toBe(0);
		expect(r.balance("user:paz", "ARS")).toBe(3_000_000);
		expectInvariant(r);
	});

	it("S5 while Juan's payment waits for your OK (D8): shown pending, To assign still 40,000", () => {
		const r = runSplits(scenario([{ ...juanPays, status: "PROPOSED" }]));
		expect(r.view.toAssign.amount.minor).toBe(4_000_000);
		expect(r.view.owed.pending.minor).toBe(3_000_000);
		expect(r.view.owed.held.minor).toBe(6_000_000);
		expectInvariant(r);
	});

	it("C14 forgiving Paz's 30,000 into Dining: To assign +30,000 (100,000), Dining -60,000, nothing held", () => {
		const r = runSplits(
			scenario([
				juanPays,
				settlement(
					"fg-paz",
					"user:paz",
					"user:me",
					"30000",
					"ARS",
					"2026-10-20",
					{
						kind: "FORGIVE",
						forgiveEnvelopeId: "dining",
					},
				),
			]),
		);
		expect(r.view.toAssign.amount.minor).toBe(10_000_000);
		expect(r.left("dining")).toBe(-6_000_000);
		expect(r.view.owed.held.minor).toBe(0);
		expectInvariant(r);
	});

	it("C14 forgiving 40,000 of a 30,000 balance releases 30,000 and lists the 10,000 extra", () => {
		const r = runSplits(
			scenario([
				juanPays,
				settlement(
					"fg-paz",
					"user:paz",
					"user:me",
					"40000",
					"ARS",
					"2026-10-20",
					{
						kind: "FORGIVE",
						forgiveEnvelopeId: "dining",
					},
				),
			]),
		);
		expect(r.view.toAssign.amount.minor).toBe(10_000_000);
		expect(r.left("dining")).toBe(-6_000_000);
		expect(r.splits.replay.ignored).toContainEqual({
			eventId: "fg-paz",
			reason: "FORGIVE_EXCEEDS_BALANCE",
			native: 1_000_000,
		});
		expectInvariant(r);
	});
});

// ── S6, S17, S18, S23: Nico, Córdoba, on a trip (ARS, blue) ───────────────

const car: TxSpec = {
	id: "t-car",
	currency: "CLP",
	date: "2026-10-05",
	paidBy: "user:me",
	category: { id: "c-trans", name: "Transport", owner: "me" },
};
const dinners: TxSpec = {
	id: "t-dinners",
	currency: "USD",
	date: "2026-10-07",
	paidBy: "user:clara",
	category: { id: "clara-food", name: "Restaurants", owner: "clara" },
};
const hostel: TxSpec = {
	id: "t-hostel",
	currency: "BRL",
	date: "2026-10-08",
	paidBy: "guest:mateo",
	category: null,
};
const NICO = {
	currency: "ARS",
	rateType: "blue",
	defaultEnvelope: "everything",
	categories: [
		{ id: "c-trans", name: "Transport" },
		{ id: "c-din", name: "Dining" },
		{ id: "c-lodging", name: "Lodging" },
	],
};

describe("S6 settling up in another currency (Nico and Clara)", () => {
	// Clara owes CLP 120,000 (half the car, ARS 183,125 at 960 and blue
	// 1,465); Nico owes USD 85 (half the dinners, ARS 124,525). On Jan 5 at
	// CLP 960: USD 85 offsets CLP 81,600, Clara sends USD 40 for the other
	// CLP 38,400. Blue is 1,530 by then, so the USD 40 is worth ARS 61,200.
	const r = runSplits({
		...NICO,
		start: 202610,
		current: 202701,
		today: "2027-01-06",
		envelopes: [
			{ id: "transport", cats: ["c-trans"] },
			{ id: "dining", cats: ["c-din"] },
			{ id: "everything" },
		],
		moneyIn: [income(202610, 100_000_000)],
		mine: [
			mine("s-car", car, "120000"),
			mine("s-dinners", dinners, "85", { categoryId: "c-din" }),
		],
		fronts: [front("f-clara-car", "user:clara", car, "120000")],
		settlements: [
			settlement(
				"o-clp",
				"user:clara",
				"user:me",
				"81600",
				"CLP",
				"2027-01-05",
				{ isOffset: true },
			),
			settlement("o-usd", "user:me", "user:clara", "85", "USD", "2027-01-05", {
				isOffset: true,
			}),
			settlement(
				"p-clp",
				"user:clara",
				"user:me",
				"38400",
				"CLP",
				"2027-01-05",
				{ converted: ["40", "USD"] },
			),
		],
	});

	it("both balances end at zero, per currency", () => {
		expect(r.balance("user:clara", "CLP")).toBe(0);
		expect(r.balance("user:clara", "USD")).toBe(0);
	});

	it("the offset returns its basis (124,525) and the cash its value received (61,200): FX note +2,600", () => {
		const back = r.splits.replay.effects.filter((e) => e.term === "RETURNED");
		expect(back.map((e) => [e.eventId, e.minor, e.fx])).toEqual([
			["o-clp", 12_452_500, 0],
			["p-clp", 6_120_000, 260_000],
		]);
	});

	it("To assign: 1,000,000 - October's 307,650 overspend + the 2,600 FX = 694,950 (D10)", () => {
		expect(r.view.toAssign.terms.splitsNet.minor).toBe(-260_000);
		expect(r.view.toAssign.amount.minor).toBe(69_495_000);
		expectInvariant(r);
	});
});

describe("S17 deleting a duplicated car rental after Clara paid for both", () => {
	// Two CLP 360,000 rentals, Clara's CLP 180,000 of each paid separately.
	// One share is CLP 180,000 = USD 187.50 = ARS 274,687.50 at blue 1,465.
	const r2: TxSpec = { ...car, id: "t-car-2" };
	const one = (t: TxSpec, n: string) => [
		mine(`s-${n}`, { ...t, currency: "CLP" }, "180000"),
	];
	const base = {
		...NICO,
		start: 202610,
		current: 202610,
		today: "2026-10-15",
		envelopes: [{ id: "transport", cats: ["c-trans"] }, { id: "everything" }],
		moneyIn: [income(202610, 100_000_000)],
	};
	const pays = (n: string) =>
		settlement(
			`p-${n}`,
			"user:clara",
			"user:me",
			"180000",
			"CLP",
			"2026-10-10",
		);

	it("before: Transport -549,375, both fronts repaid, To assign 1,000,000", () => {
		const r = runSplits({
			...base,
			mine: [...one(car, "1"), ...one(r2, "2")],
			fronts: [
				front("f-1", "user:clara", car, "180000"),
				front("f-2", "user:clara", r2, "180000"),
			],
			settlements: [pays("1"), pays("2")],
		});
		expect(r.left("transport")).toBe(-54_937_500);
		expect(r.view.toAssign.amount.minor).toBe(100_000_000);
		expectInvariant(r);
	});

	it("Keep the credit: Clara's second payment becomes what you owe her (CLP 180,000); To assign unchanged", () => {
		const r = runSplits({
			...base,
			mine: one(car, "1"),
			fronts: [front("f-1", "user:clara", car, "180000")],
			settlements: [pays("1"), pays("2")],
		});
		expect(r.balance("user:clara", "CLP")).toBe(-180_000);
		expect(r.left("transport")).toBe(-27_468_750);
		expect(r.view.toAssign.amount.minor).toBe(100_000_000);
		expectInvariant(r);
	});

	it("Void the payment: nothing owed either way; To assign unchanged, Transport +274,687.50", () => {
		const r = runSplits({
			...base,
			mine: one(car, "1"),
			fronts: [front("f-1", "user:clara", car, "180000")],
			settlements: [pays("1")],
		});
		expect(r.balance("user:clara", "CLP")).toBe(0);
		expect(r.left("transport")).toBe(-27_468_750);
		expect(r.view.toAssign.amount.minor).toBe(100_000_000);
		expectInvariant(r);
	});
});

describe("S18 a guest's split, paid back in ARS (Nico and Mateo)", () => {
	// BRL 400 at 5.40 and blue 1,465: 74.0740... USD = ARS 108,518.52.
	const base = {
		...NICO,
		start: 202610,
		current: 202610,
		today: "2026-10-20",
		envelopes: [{ id: "lodging", cats: ["c-lodging"] }, { id: "everything" }],
		moneyIn: [income(202610, 50_000_000)],
		mine: [mine("s-hostel", hostel, "400", { categoryId: "c-lodging" })],
	};

	it("Lodging takes BRL 400 at the expense-date rate; you owe Mateo BRL 400", () => {
		const r = runSplits(base);
		expect(r.left("lodging")).toBe(-10_851_852);
		expect(r.balance("guest:mateo", "BRL")).toBe(-40_000);
		expect(r.view.toAssign.amount.minor).toBe(50_000_000);
		expectInvariant(r);
	});

	it("paying ARS 108,000 for it clears the debt and never reaches the budget (02 §9.1 Q3)", () => {
		const r = runSplits({
			...base,
			settlements: [
				settlement(
					"p-mateo",
					"user:me",
					"guest:mateo",
					"400",
					"BRL",
					"2026-10-12",
					{
						converted: ["108000", "ARS"],
					},
				),
			],
		});
		expect(r.balance("guest:mateo", "BRL")).toBe(0);
		expect(r.view.toAssign.amount.minor).toBe(50_000_000);
		expect(r.left("lodging")).toBe(-10_851_852);
		expectInvariant(r);
	});
});

describe("S23 a trip counted in one envelope, or not in the budget (Nico)", () => {
	const inTrip = (t: TxSpec) => ({ ...t, projectId: "trip" });
	const base = {
		...NICO,
		start: 202610,
		current: 202610,
		today: "2026-10-20",
		envelopes: [
			{ id: "trip" },
			{ id: "lodging", cats: ["c-lodging"] },
			{ id: "transport", cats: ["c-trans"] },
			{ id: "dining", cats: ["c-din"] },
			{ id: "everything" },
		],
		moneyIn: [income(202610, 100_000_000)],
		mine: [
			mine("s-hostel", inTrip(hostel), "400", { categoryId: "c-lodging" }),
			mine("s-car", inTrip(car), "120000"),
			mine("s-dinners", inTrip(dinners), "85"),
		],
		fronts: [front("f-clara-car", "user:clara", inTrip(car), "120000")],
	};

	it("Count my share in Trip: BRL, CLP and USD shares all land in Trip, whatever their category", () => {
		const r = runSplits({
			...base,
			routes: [
				{
					projectId: "trip",
					budgetRouting: "ENVELOPE",
					budgetEnvelopeId: "trip",
					project: { name: "Trip" },
				},
			],
		});
		// 108,518.52 + 183,125 + 124,525 = 416,168.52
		expect(r.left("trip")).toBe(-41_616_852);
		expect(r.left("lodging")).toBe(0);
		expect(r.left("transport")).toBe(0);
		expect(r.left("dining")).toBe(0);
		expect(r.view.shares.unresolved).toBe(0);
		// Fronting still leaves To assign: Clara's half of the car.
		expect(r.view.toAssign.amount.minor).toBe(100_000_000 - 18_312_500);
		expectInvariant(r);
	});

	it("Not in budget: no share, no fronting; the project is listed, never counted", () => {
		const r = runSplits({
			...base,
			routes: [
				{
					projectId: "trip",
					budgetRouting: "NOT_IN_BUDGET",
					budgetEnvelopeId: null,
					project: { name: "Trip" },
				},
			],
		});
		expect(r.left("trip")).toBe(0);
		expect(r.view.toAssign.amount.minor).toBe(100_000_000);
		expect(r.splits.notInBudget).toEqual([{ projectId: "trip", name: "Trip" }]);
		expect(r.splits.replay.ignored).toContainEqual({
			eventId: "f-clara-car",
			reason: "NOT_IN_BUDGET",
			native: 120_000,
		});
		expectInvariant(r);
	});
});

// ── C8: an employer flight (USD) ───────────────────────────────────────────

describe("C8 for someone else: a work flight the employer repays", () => {
	const flight: TxSpec = {
		id: "t-flight",
		currency: "USD",
		date: "2026-10-03",
		paidBy: "user:me",
		category: null,
	};
	const base = {
		currency: "USD",
		start: 202610,
		envelopes: [{ id: "everything" }],
		defaultEnvelope: "everything",
		moneyIn: [income(202610, 300_000)],
		fronts: [front("f-work", "shadow:work", flight, "800")],
	};

	it("your share is 0: USD 800 leaves To assign (3,000 to 2,200), no envelope moves", () => {
		const r = runSplits({ ...base, current: 202610, today: "2026-10-20" });
		expect(r.view.toAssign.amount.minor).toBe(220_000);
		expect(r.left("everything")).toBe(0);
		expect(r.view.owed.held.minor).toBe(80_000);
		expectInvariant(r);
	});

	it("the employer repays in November: To assign back to 3,000, nothing held", () => {
		const r = runSplits({
			...base,
			current: 202611,
			today: "2026-11-20",
			settlements: [
				settlement(
					"p-work",
					"shadow:work",
					"user:me",
					"800",
					"USD",
					"2026-11-14",
				),
			],
		});
		expect(r.view.toAssign.amount.minor).toBe(300_000);
		expect(r.view.owed.held.minor).toBe(0);
		expectInvariant(r);
	});
});

// ── Open balances when the budget starts (owner decision 2026-10-23) ───────

describe("balances from before the budget started are part of the starting position", () => {
	const usdBook = {
		currency: "USD",
		start: 202610,
		current: 202610,
		today: "2026-10-20",
		envelopes: [{ id: "groceries", cats: ["c-groc"] }, { id: "everything" }],
		defaultEnvelope: "everything",
		moneyIn: [income(202610, 100_000)],
		categories: [{ id: "c-groc", name: "Groceries" }],
	};
	const septGroceries: TxSpec = {
		id: "t-sept",
		currency: "USD",
		date: "2026-09-20",
		paidBy: "user:sam",
	};

	it("a debt from before the start, paid after it: To assign drops by the 70 paid (1,000 to 930)", () => {
		const r = runSplits({
			...usdBook,
			mine: [mine("s-sept", septGroceries, "70", { categoryId: "c-groc" })],
			settlements: [
				settlement("p-sam", "user:me", "user:sam", "70", "USD", "2026-10-05"),
			],
		});
		expect(r.view.toAssign.terms.splitsNet.minor).toBe(7_000);
		expect(r.view.toAssign.amount.minor).toBe(93_000);
		// September's share is in the starting position, not in October's envelopes.
		expect(r.left("groceries")).toBe(0);
		expect(r.balance("user:sam", "USD")).toBe(0);
		expectInvariant(r);
	});

	it("paying old and new debts together: the old part leaves To assign, the new part was already in the envelope", () => {
		const oct: TxSpec = { ...septGroceries, id: "t-oct", date: "2026-10-03" };
		const r = runSplits({
			...usdBook,
			mine: [
				mine("s-sept", septGroceries, "70", { categoryId: "c-groc" }),
				mine("s-oct", oct, "20", { categoryId: "c-groc" }),
			],
			settlements: [
				settlement("p-sam", "user:me", "user:sam", "90", "USD", "2026-10-10"),
			],
		});
		expect(r.view.toAssign.amount.minor).toBe(93_000);
		expect(r.left("groceries")).toBe(-2_000);
		expectInvariant(r);
	});

	it("money owed to you from before the start counts when it arrives: To assign rises by the 30 (1,000 to 1,030)", () => {
		const septDinner: TxSpec = {
			id: "t-dinner",
			currency: "USD",
			date: "2026-09-10",
			paidBy: "user:me",
		};
		const r = runSplits({
			...usdBook,
			fronts: [front("f-juan", "user:juan", septDinner, "30")],
			settlements: [
				settlement("p-juan", "user:juan", "user:me", "30", "USD", "2026-10-08"),
			],
		});
		expect(r.view.toAssign.amount.minor).toBe(103_000);
		expectInvariant(r);
	});

	it("not yet received, it is held by no one: To assign stays 1,000", () => {
		const septDinner: TxSpec = {
			id: "t-dinner",
			currency: "USD",
			date: "2026-09-10",
			paidBy: "user:me",
		};
		const r = runSplits({
			...usdBook,
			fronts: [front("f-juan", "user:juan", septDinner, "30")],
		});
		expect(r.view.toAssign.amount.minor).toBe(100_000);
		expect(r.balance("user:juan", "USD")).toBe(3_000);
		expectInvariant(r);
	});

	it("cross-currency: a BRL 400 debt from September paid in October with ARS 108,000 takes the 108,000 paid", () => {
		const r = runSplits({
			...NICO,
			start: 202610,
			current: 202610,
			today: "2026-10-20",
			envelopes: [{ id: "lodging", cats: ["c-lodging"] }, { id: "everything" }],
			moneyIn: [income(202610, 50_000_000)],
			mine: [
				mine("s-hostel", { ...hostel, date: "2026-09-08" }, "400", {
					categoryId: "c-lodging",
				}),
			],
			settlements: [
				settlement(
					"p-mateo",
					"user:me",
					"guest:mateo",
					"400",
					"BRL",
					"2026-10-12",
					{
						converted: ["108000", "ARS"],
					},
				),
			],
		});
		expect(r.view.toAssign.amount.minor).toBe(50_000_000 - 10_800_000);
		expect(r.left("lodging")).toBe(0);
		expect(r.balance("guest:mateo", "BRL")).toBe(0);
		expectInvariant(r);
	});
});

describe("forgiving what was owed to you from before the start (owner 2026-10-23)", () => {
	const base = {
		currency: "USD",
		start: 202610,
		current: 202610,
		today: "2026-10-20",
		envelopes: [{ id: "dining", cats: ["c-din"] }, { id: "everything" }],
		defaultEnvelope: "everything",
		moneyIn: [income(202610, 100_000)],
	};
	const sept: TxSpec = {
		id: "t-sept",
		currency: "USD",
		date: "2026-09-10",
		paidBy: "user:me",
	};
	const oct: TxSpec = {
		id: "t-oct",
		currency: "USD",
		date: "2026-10-02",
		paidBy: "user:me",
	};
	const forgiveJuan = (amount: string) =>
		settlement("fg", "user:juan", "user:me", amount, "USD", "2026-10-15", {
			kind: "FORGIVE",
			forgiveEnvelopeId: "dining",
		});

	it("its fronting was never in the budget: forgiving it moves nothing (To assign 1,000, Dining 0)", () => {
		const r = runSplits({
			...base,
			fronts: [front("f-sept", "user:juan", sept, "30")],
			settlements: [forgiveJuan("30")],
		});
		expect(r.view.toAssign.amount.minor).toBe(100_000);
		expect(r.left("dining")).toBe(0);
		expect(r.balance("user:juan", "USD")).toBe(0);
		expectInvariant(r);
	});

	it("old first: forgiving 40 of 30 old and 20 new releases only 10 of the new (To assign 990, Dining -10)", () => {
		const r = runSplits({
			...base,
			fronts: [
				front("f-sept", "user:juan", sept, "30"),
				front("f-oct", "user:juan", oct, "20"),
			],
			settlements: [forgiveJuan("40")],
		});
		// 1,000 - 20 fronted in October + 10 forgiven back.
		expect(r.view.toAssign.amount.minor).toBe(99_000);
		expect(r.left("dining")).toBe(-1_000);
		expect(r.balance("user:juan", "USD")).toBe(1_000);
		expectInvariant(r);
	});
});
