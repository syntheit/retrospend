import { describe, expect, it } from "vitest";
import { type PayoffDebt, type PayoffInput, projectPayoff } from "./payoff";

const m = (n: number) => Math.round(n * 100);

const debt = (
	id: string,
	balance: number,
	apr: string,
	minimum: number,
	o: Partial<PayoffDebt> = {},
): PayoffDebt => ({
	id,
	currency: "ARS",
	balance: m(balance),
	aprPercent: apr,
	minimum: m(minimum),
	bookPerUnit: "1",
	...o,
});

const payoffInput = (
	o: Partial<PayoffInput> & Pick<PayoffInput, "debts">,
): PayoffInput => ({
	bookCurrency: "ARS",
	strategy: "SNOWBALL",
	extraMonthly: 0,
	startMonth: 202610,
	...o,
});

const run = (o: Partial<PayoffInput> & Pick<PayoffInput, "debts">) =>
	projectPayoff(payoffInput(o));

/** Invariant on every finished schedule: each debt paid its balance plus its interest. */
function expectPaidInFull(
	input: PayoffInput,
	result: ReturnType<typeof projectPayoff>,
) {
	expect(result.capped).toBe(false);
	for (const d of result.debts) {
		const start = input.debts.find((x) => x.id === d.id)?.balance ?? 0;
		expect(d.paid, d.id).toBe(start + d.interest);
	}
}

describe("projectPayoff (SPEC §5.11)", () => {
	const two = [debt("card", 5_000, "24", 150), debt("loan", 1_000, "6", 50)];

	it.each([
		{
			name: "snowball: smallest balance first, the loan clears in month 5",
			strategy: "SNOWBALL" as const,
			debtFree: 202804,
			interest: 1_152.32,
			payoff: { card: 202804, loan: 202703 },
			next: { card: [150, 0], loan: [50, 200] },
		},
		{
			name: "avalanche: highest APR first, less interest",
			strategy: "AVALANCHE" as const,
			debtFree: 202804,
			interest: 1_001.6,
			payoff: { card: 202803, loan: 202804 },
			next: { card: [150, 200], loan: [50, 0] },
		},
	])("$name", ({ strategy, debtFree, interest, payoff, next }) => {
		const input: PayoffInput = {
			bookCurrency: "ARS",
			debts: two,
			strategy,
			extraMonthly: m(200),
			startMonth: 202610,
		};
		const out = projectPayoff(input);
		expect(out.debtFreeMonth).toBe(debtFree);
		expect(out.months).toBe(18);
		expect(out.totalInterest).toBe(m(interest));
		for (const d of out.debts) {
			expect(d.payoffMonth).toBe(payoff[d.id as "card" | "loan"]);
			expect([d.nextMinimum, d.nextExtra]).toEqual(
				next[d.id as "card" | "loan"].map(m),
			);
		}
		expectPaidInFull(input, out);
	});

	it("custom order follows the list the user set", () => {
		const i = payoffInput({
			debts: two,
			strategy: "CUSTOM",
			customOrder: ["loan", "card"],
			extraMonthly: m(200),
		});
		const out = projectPayoff(i);
		expect(out.debts.find((d) => d.id === "loan")?.payoffMonth).toBe(202703);
		expect(out.totalInterest).toBe(m(1_152.32));
		expectPaidInFull(i, out);
	});

	it("a single card at 12% with a 100 minimum: 13 months, 84.78 interest (hand-checked first month 1,212 - 100)", () => {
		const i = payoffInput({ debts: [debt("visa", 1_200, "12", 100)] });
		const out = projectPayoff(i);
		expect(out).toMatchObject({
			months: 13,
			debtFreeMonth: 202711,
			totalInterest: m(84.78),
			capped: false,
		});
		expect(out.debts[0]?.nextMinimum).toBe(m(100));
		expectPaidInFull(i, out);
	});

	it("zero APR: freed minimums roll over to the next debt", () => {
		const i = payoffInput({
			debts: [debt("a", 1_000, "0", 100), debt("b", 500, "0", 50)],
			extraMonthly: m(100),
		});
		const out = projectPayoff(i);
		expectPaidInFull(i, out);
		expect(out.debts.map((d) => [d.id, d.payoffMonth])).toEqual([
			["a", 202704],
			["b", 202702],
		]);
		expect(out.months).toBe(6);
		expect(out.totalInterest).toBe(0);
	});

	it("a foreign-currency debt is projected in its own currency; the ARS extra converts at today's rate", () => {
		const usd = debt("usd-loan", 1_000, "0", 100, {
			currency: "USD",
			bookPerUnit: "1465",
		});
		const i = payoffInput({ debts: [usd], extraMonthly: m(146_500) });
		const out = projectPayoff(i);
		expect(out.months).toBe(5);
		expectPaidInFull(i, out);
		expect(out.debts[0]).toMatchObject({
			nextMinimum: m(100),
			nextExtra: m(100),
			payoffMonth: 202703,
		});
	});

	it("a foreign debt's interest is totaled in H at today's rate", () => {
		const usd = debt("usd-card", 1_200, "12", 100, {
			currency: "USD",
			bookPerUnit: "1465",
		});
		const out = run({ debts: [usd] });
		expect(out.debts[0]?.interest).toBe(m(84.78));
		expect(out.totalInterest).toBe(m(84.78 * 1_465));
	});

	it("stops at 50 years when the minimum never covers the interest", () => {
		const out = run({ debts: [debt("payday", 10_000, "24", 100)] });
		expect(out).toMatchObject({
			capped: true,
			debtFreeMonth: null,
			months: 600,
		});
		expect(out.debts[0]?.payoffMonth).toBeNull();
	});

	it("a minimum far below the interest ends the schedule instead of throwing (Visa, 118% APR, minimum 40,000)", () => {
		// Month 1 by hand: 2,500,000 x 118 / 1200 = 245,833.33 interest, so a 40,000 payment
		// leaves 2,705,833.33: the balance grows about 9.8% a month and never comes down.
		const visa = debt("visa", 2_500_000, "118", 40_000);
		const out = run({ debts: [visa] });
		expect(out).toMatchObject({
			capped: true,
			diverges: true,
			debtFreeMonth: null,
		});
		expect(out.months).toBeLessThan(600);
		expect(out.schedule[0]?.balances[0]).toBe(m(2_705_833.33));
		expect(out.debts[0]?.payoffMonth).toBeNull();
		expect(Number.isSafeInteger(out.totalInterest)).toBe(true);
	});

	it("a slow shortfall reaches the 50-year cap without diverging", () => {
		expect(run({ debts: [debt("payday", 10_000, "24", 100)] }).diverges).toBe(
			false,
		);
	});

	it("a foreign debt that diverges stays safe in the book currency", () => {
		const usd = debt("usd-card", 5_000, "118", 100, {
			currency: "USD",
			bookPerUnit: "1465",
		});
		const out = run({ debts: [usd] });
		expect(out.diverges).toBe(true);
		expect(Number.isSafeInteger(out.totalInterest)).toBe(true);
	});

	it("no debts: debt-free now", () => {
		expect(run({ debts: [] })).toMatchObject({
			months: 0,
			debtFreeMonth: 202610,
			totalInterest: 0,
			capped: false,
		});
	});

	it("a debt already at 0 frees nothing: its minimum was never being paid", () => {
		// By hand: the loan alone, 100 at 25 a month, no interest, no extra: 4 months, Nov to Feb.
		const out = run({
			debts: [debt("done", 0, "10", 50), debt("loan", 100, "0", 25)],
		});
		expect(out.debts.map((d) => d.payoffMonth)).toEqual([202610, 202702]);
		expect(out.months).toBe(4);
	});

	it("a debt paid off during the projection frees its minimum", () => {
		// By hand: a = 50 at 50 a month clears in Nov; b = 300 at 50: Nov 250, then 100 a month: Dec 150, Jan 50, Feb 0.
		const out = run({
			debts: [debt("a", 50, "0", 50), debt("b", 300, "0", 50)],
		});
		expect(out.debts.map((d) => d.payoffMonth)).toEqual([202611, 202702]);
	});

	it.each(["0", "-1465"])(
		"rejects a book rate of %s for a foreign debt",
		(bookPerUnit) => {
			expect(() =>
				run({
					debts: [debt("usd", 100, "0", 10, { currency: "USD", bookPerUnit })],
				}),
			).toThrow(/rate to the book currency must be positive/);
		},
	);

	it("rejects negative balances", () => {
		expect(() => run({ debts: [debt("x", -1, "0", 0)] })).toThrow(RangeError);
	});
});

/**
 * Three debts worked out by hand, month by month, from November 2026. The
 * rounding rule: each month interest = balance x APR / 1200 in minor units,
 * rounded half-even (18.24 cents is 18, 409.55 is 410); then each debt's
 * minimum; then the extra (100.00) plus every freed minimum to the target.
 *
 *   A 300.00 at 24% (2% a month), minimum 50.00
 *   B 500.00 at 12% (1% a month), minimum 50.00
 *   C 200.00 at 0%, minimum 20.00
 *
 * Avalanche (A, then B, then C):
 *   Dec: A 300 + 6.00 - 50 = 256.00, extra 100 -> 156.00; B 505 - 50 = 455.00; C 180.00
 *   Jan: A 156 + 3.12 - 50 - 100 = 9.12; B 455 + 4.55 - 50 = 409.55; C 160.00
 *   Feb: A 9.12 + 0.18 = 9.30, its minimum pays it off and frees 40.70;
 *        B 409.55 + 4.10 - 50 = 363.65, pool 140.70 -> 222.95; C 140.00
 *   Mar: B 222.95 + 2.23 - 50 = 175.18, pool 150 (A's 50 freed) -> 25.18; C 120.00
 *   Apr: B 25.18 + 0.25 = 25.43, its minimum pays it off and frees 24.57;
 *        C 120 - 20 = 100.00, pool 174.57 pays it off. Debt-free April 2027.
 *   Interest A 9.30, B 16.13, C 0: 25.43.
 * Snowball (smallest balance first, after this month's minimums):
 *   Dec: A 256.00; B 455.00; C 180.00 - 100 = 80.00
 *   Jan: A 256 + 5.12 - 50 = 211.12; B 409.55; C 80 - 20 = 60.00, pool 100 pays
 *        C off and 40 goes to A: 171.12
 *   Feb: A 171.12 + 3.42 - 50 = 124.54, pool 120 (C's 20 freed) -> 4.54; B 363.65
 *   Mar: A 4.54 + 0.09 = 4.63 paid by its minimum, frees 45.37;
 *        B 363.65 + 3.64 - 50 = 317.29, pool 165.37 -> 151.92
 *   Apr: B 151.92 + 1.52 - 50 = 103.44, pool 170 pays it off. Debt-free April 2027.
 *   Interest A 14.63, B 18.81: 33.44.
 */
describe("hand-worked three-debt schedules", () => {
	const three = [
		debt("A", 300, "24", 50, { currency: "USD" }),
		debt("B", 500, "12", 50, { currency: "USD" }),
		debt("C", 200, "0", 20, { currency: "USD" }),
	];
	const plan = (strategy: PayoffInput["strategy"]) =>
		payoffInput({
			bookCurrency: "USD",
			debts: three,
			strategy,
			extraMonthly: m(100),
			startMonth: 202611,
		});
	const rows = (r: ReturnType<typeof projectPayoff>) =>
		r.schedule.map((s) => [s.month, ...s.balances]);

	it("avalanche: debt-free April 2027, 25.43 interest", () => {
		const input = plan("AVALANCHE");
		const r = projectPayoff(input);
		expect(rows(r)).toEqual([
			[202612, m(156), m(455), m(180)],
			[202701, m(9.12), m(409.55), m(160)],
			[202702, 0, m(222.95), m(140)],
			[202703, 0, m(25.18), m(120)],
			[202704, 0, 0, 0],
		]);
		expect(r.debtFreeMonth).toBe(202704);
		expect(r.debts.map((d) => [d.id, d.payoffMonth, d.interest])).toEqual([
			["A", 202702, m(9.3)],
			["B", 202704, m(16.13)],
			["C", 202704, 0],
		]);
		expect(r.totalInterest).toBe(m(25.43));
		expect(r.debts.map((d) => [d.nextMinimum, d.nextExtra])).toEqual([
			[m(50), m(100)],
			[m(50), 0],
			[m(20), 0],
		]);
		expectPaidInFull(input, r);
	});

	it("snowball: debt-free April 2027, 33.44 interest", () => {
		const input = plan("SNOWBALL");
		const r = projectPayoff(input);
		expect(rows(r)).toEqual([
			[202612, m(256), m(455), m(80)],
			[202701, m(171.12), m(409.55), 0],
			[202702, m(4.54), m(363.65), 0],
			[202703, 0, m(151.92), 0],
			[202704, 0, 0, 0],
		]);
		expect(r.debts.map((d) => [d.id, d.payoffMonth, d.interest])).toEqual([
			["A", 202703, m(14.63)],
			["B", 202704, m(18.81)],
			["C", 202701, 0],
		]);
		expect(r.totalInterest).toBe(m(33.44));
		expectPaidInFull(input, r);
	});
});
