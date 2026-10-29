import { type Glance, budgetStatusOf, notPlannedOf, spentOf } from "./source";

const money = (minor: number) => ({ minor, currency: "ARS" });

const base = {
	home: "ARS",
	today: "2026-10-25",
	period: { from: "2026-10-01", to: "2026-10-31", days: 31, day: 25 },
	lastPeriod: { from: "2026-09-01", to: "2026-09-30", days: 30 },
	spent: { id: "glance.spent", value: money(167467100) },
	spentLastToDate: { id: "glance.spentLastToDate", value: money(379923200) },
	spentLast: { id: "glance.spentLast", value: money(391103200) },
	pace: { this: null, last: null, fasterThanLast: null },
	owedToYou: { id: "owed.owedToYou", value: money(1) },
	youOwe: { id: "owed.youOwe", value: money(1) },
	netWorth: { id: "netWorth", value: money(1) },
	budget: null,
	moneyIn: null,
	dollarToday: null,
	missingRates: [],
} satisfies Glance;

describe("spentOf", () => {
	it("leads with Spent, budget or not", () => {
		const budget = {
			state: "ready",
			verdict: { state: "ON_TRACK" },
			leftToSpend: { left: money(5916100), over: money(0) },
		};
		for (const glance of [base, { ...base, budget } as unknown as Glance]) {
			expect(spentOf(glance)).toEqual({
				amount: money(167467100),
				lastToDate: money(379923200),
				fasterThanLast: null,
				lastMonth: "2026-09-01",
			});
		}
	});

	it("carries the server's pace against last month", () => {
		const pace = { this: null, last: null, fasterThanLast: true };
		expect(spentOf({ ...base, pace }).fasterThanLast).toBe(true);
	});

	it("keeps a missing figure missing, never zero", () => {
		const spent = spentOf({
			...base,
			spent: { id: "glance.spent", value: null },
		});
		expect(spent.amount).toBeNull();
	});
});

describe("budgetStatusOf", () => {
	it("has no status without a budget", () => {
		expect(budgetStatusOf(base)).toBeNull();
	});

	it("has none while a rate is missing", () => {
		const budget = { state: "incomplete", missingRates: ["EUR"] };
		expect(budgetStatusOf({ ...base, budget } as unknown as Glance)).toBeNull();
	});

	it("reads Left to spend when the budget has a verdict", () => {
		const status = budgetStatusOf({
			...base,
			budget: {
				state: "ready",
				verdict: { state: "ON_TRACK" },
				leftToSpend: {
					left: money(5916100),
					over: money(0),
					perDay: money(537800),
					daysLeft: 11,
					spent: money(270660200),
				},
			},
		} as unknown as Glance);
		expect(status).toEqual({
			kind: "left",
			amount: money(5916100),
			perDay: money(537800),
			daysLeft: 11,
			spent: money(270660200),
		});
	});

	it("says how far over once the verdict is over, not a negative Left to spend", () => {
		const verdict = {
			state: "OVER_BUDGET",
			lead: {
				kind: "LEFT_TO_SPEND",
				figureId: "budget.leftToSpend",
				amount: money(192030),
			},
		};
		const status = budgetStatusOf({
			...base,
			budget: {
				state: "ready",
				verdict,
				leftToSpend: { left: money(-192030) },
			},
		} as unknown as Glance);
		expect(status).toEqual({ kind: "over", verdict, amount: money(192030) });
	});

	it("is over whenever leftToSpend.over is positive, whatever the verdict says", () => {
		const verdict = {
			style: "SPENDING",
			state: "ON_TRACK",
			lead: { kind: "LEFT_TO_SPEND", figureId: "x", amount: money(-500) },
			over: money(0),
		};
		const status = budgetStatusOf({
			...base,
			budget: {
				state: "ready",
				verdict,
				leftToSpend: { left: money(-500), over: money(500) },
			},
		} as unknown as Glance);
		expect(status).toMatchObject({ kind: "over", amount: money(500) });
		if (status?.kind === "over") {
			expect(status.verdict.state).toBe("OVER_BUDGET");
			expect(status.verdict.lead.amount).toEqual(money(500));
		}
	});

	it("never leads with a negative Left to spend", () => {
		const status = budgetStatusOf({
			...base,
			budget: {
				state: "ready",
				verdict: {
					style: "SPENDING",
					state: "ON_TRACK",
					lead: { kind: "LEFT_TO_SPEND", figureId: "x", amount: money(0) },
					over: money(0),
				},
				leftToSpend: { left: money(-700), over: money(0) },
			},
		} as unknown as Glance);
		expect(status).toMatchObject({ kind: "over", amount: money(700) });
	});
});

describe("notPlannedOf", () => {
	const ready = (
		value: ReturnType<typeof money> | null,
		poolName = "NOT_PLANNED_YET",
	) =>
		({
			...base,
			budget: {
				state: "ready",
				verdict: { poolName },
				notPlannedYet: { id: "budget.notPlannedYet", value },
			},
		}) as unknown as Glance;

	it("shows the money that has no job yet, named as the plan names it", () => {
		expect(notPlannedOf(ready(money(85000000)))).toEqual({
			amount: money(85000000),
			pool: "NOT_PLANNED_YET",
		});
		expect(notPlannedOf(ready(money(100), "TO_ASSIGN"))?.pool).toBe(
			"TO_ASSIGN",
		);
	});

	it("shows nothing for zero, planned too much, a missing rate or no budget", () => {
		expect(notPlannedOf(ready(money(0)))).toBeNull();
		expect(notPlannedOf(ready(money(-100)))).toBeNull();
		expect(notPlannedOf(ready(null))).toBeNull();
		expect(notPlannedOf(base)).toBeNull();
	});
});
